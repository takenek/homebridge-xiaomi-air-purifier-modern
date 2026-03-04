# Reliability and status test plan

This plugin uses automated Vitest scenarios to validate reconnect behavior and HomeKit state synchronization.

## Strategy for mode switches while power is OFF

When purifier power is OFF, mode switches are not exposed as independently available controls.
State reconciliation keeps HomeKit characteristics aligned with the single source of truth (`DeviceClient.state`) and avoids creating extra switch accessories in OFF state transitions.

## Buzzer control: pro model compatibility

The `zhimi.airpurifier.pro` model uses the legacy MIIO protocol and the `set_buzzer` command with `"on"`/`"off"` string params instead of the newer MIOT protocol or `set_buzzer_volume` with a numeric volume. The transport layer handles this transparently:

1. **Protocol detection**: The Pro model is in the `LEGACY_PREFERRED_MODELS` set, so the MIOT probe is skipped entirely during protocol detection. This prevents cascading `-5001` command errors that overwhelm the device when MIOT commands are sent to a legacy-only device.
2. **MIOT probe item code validation**: For non-legacy-preferred models, the MIOT detection probe now also validates the item response code (`code === 0`), preventing false MIOT detection when a device responds to `get_properties` but returns error codes in individual items.
3. In legacy mode, if `set_buzzer_volume` fails (command error), the transport automatically retries with `set_buzzer` and `"on"`/`"off"`.
4. For reading, the `buzzer` property alias (`"on"`/`"off"` strings) is mapped to a numeric buzzer volume (100/0) via the `toBuzzerVolume` converter.

This makes the buzzer switch work correctly in HomeKit for both `pro` and `3h`/`4` models.

## Automated scenarios

All scenarios below are covered in tests (`test/network-scenarios.test.ts` and accessory sync tests).

1. **[S1] Purifier restart**
   - **Given** a previously reachable purifier restarts and temporary `ECONNRESET` happens.
   - **When** the device responds again on the next polling cycle.
   - **Then** plugin logs recovery, emits state update, and HomeKit-visible state is refreshed without Homebridge restart.

2. **[S2] Wi-Fi router restart**
   - **Given** connectivity loss (`ENETDOWN` / `ENETUNREACH`) after initial sync.
   - **When** network returns and command path is retried.
   - **Then** plugin reconnects, reads current status, and state remains synchronized.

3. **[S3] Packet loss / unstable network**
   - **Given** intermittent timeout-class errors (`ETIMEDOUT`, `ESOCKETTIMEDOUT`).
   - **When** retry/backoff executes.
   - **Then** plugin avoids crashes/flapping and converges to stable state once read succeeds.

4. **[S4] Homebridge restart**
   - **Given** plugin process starts fresh.
   - **When** first device poll finishes.
   - **Then** accessory state is initialized deterministically from current device values.

5. **[S5] Plugin restart (disable/enable, hot reload)**
   - **Given** init/shutdown cycle repeats.
   - **When** plugin is shut down and started again.
   - **Then** timers are cleaned up (no leaks) and accessory lifecycle remains stable (no duplicate behavior).

6. **[S6] Short Wi-Fi outage (5-30s class)**
   - **Given** transient DNS/network error (`EAI_AGAIN`).
   - **When** connection returns quickly.
   - **Then** plugin restores state rapidly and continues normal operation.

7. **[S7] Long Wi-Fi outage (minutes class)**
   - **Given** repeated network-down responses that exceed immediate retry budget.
   - **When** polling continues and network later recovers.
   - **Then** plugin stays alive, logs degraded state, and fully resynchronizes on successful command/status call.

8. **Filter life drops to 4%**
   - **Given** `filter1_life` falls to replacement threshold.
   - **When** accessory state refresh runs.
   - **Then** `FilterChangeIndication` is set to `1` (`CHANGE_FILTER`).

9. **Filter replacement (4% -> 100%)**
   - **Given** filter replacement is completed and `filter1_life` returns to 100.
   - **When** next state refresh runs.
   - **Then** `FilterChangeIndication` is reset to `0` (`FILTER_OK`).

## How to run

```bash
npm install
npm run lint          # biome check
npm run typecheck     # tsc --noEmit
npm test              # vitest --coverage (requires 100% coverage)
```

All 9 scenarios are automated and run as part of the standard `npm test` suite. No manual testing steps are required.
