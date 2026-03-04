# Reliability and status test plan

This plugin uses automated Vitest scenarios to validate reconnect behavior and HomeKit state synchronization.

## Strategy for mode switches while power is OFF

When purifier power is OFF, mode switches are not exposed as independently available controls.
State reconciliation keeps HomeKit characteristics aligned with the single source of truth (`DeviceClient.state`) and avoids creating extra switch accessories in OFF state transitions.

## Buzzer control: pro model compatibility

The `zhimi.airpurifier.pro` model is a hybrid device: it supports MIOT protocol for reading most properties but requires legacy MIIO commands for certain writes (notably buzzer control). The transport layer handles this transparently:

1. **Protocol detection**: The Pro model responds to the MIOT `get_properties` probe with `code: 0` for core properties (power, mode, etc.), so it is correctly detected as MIOT-capable. The probe validates the response item code (`code === 0`) before confirming MIOT mode.
2. **Hybrid read**: After the MIOT batch read, any properties that were not returned (e.g. `buzzer_volume` on the Pro model) are automatically supplemented via a small legacy `get_prop` batch call. This ensures complete state reads without requiring a full legacy property batch (which some devices reject with `-5001`).
3. **MIOT buzzer compatibility matrix**: For `set_buzzer_volume`, MIOT writes now try multiple known mappings in sequence (`siid:5/piid:1`, `siid:5/piid:2`, `siid:6/piid:1`, `siid:6/piid:2`) before declaring MIOT unsupported for that call. This covers firmware variants that expose buzzer as a boolean flag vs volume integer on different services.
4. **Per-call legacy fallback for writes**: When MIOT candidates still fail for a specific property, the transport falls back to the legacy `call()` path for that command only, **without permanently switching the protocol mode**. This prevents hybrid devices from losing MIOT read capability after a single write failure.
5. **Buzzer legacy chain**: In legacy mode, if `set_buzzer_volume` fails (command error), the transport retries additional Pro-specific `set_buzzer_volume` payload variants (`"on"/"off"`, boolean, numeric) before trying `set_buzzer` (`"on"/"off"`, boolean, numeric, and no-arg), then `set_sound` variants, then `set_mute` variants (inverse semantics). This addresses firmware variants that expose only `set_buzzer_volume` but reject `100/0` payloads.
6. **Buzzer value conversion**: The `buzzer` property alias (`"on"`/`"off"` strings or boolean) is mapped to a numeric buzzer volume (100/0) via the `toBuzzerVolume` converter, both in MIOT supplement reads and legacy reads.
7. **Command-error reconciliation for Pro**: If buzzer write payloads return command errors, the transport verifies aliases via `get_prop` both before dynamic alias writes and once again after they fail. If either probe confirms that state already matches the requested target, the command is treated as successful. This prevents false HomeKit write failures on firmware variants that apply the state despite returning `-5001` for the setter call.
8. **Post-write state verification on Pro**: Some Pro firmware variants acknowledge a buzzer setter call but do not actually change the state. After each successful legacy buzzer write attempt (including dynamic `set_<alias>` calls), the plugin immediately probes buzzer aliases (`get_prop`) and only exits when observed state matches requested on/off target; otherwise it continues fallback variants.
9. **Dynamic volume payload compatibility**: Dynamic `set_<alias>` calls for volume-like aliases (`buzzer_volume`, `sound_volume`, `volume`) now try `100/0` (and string numeric forms) in addition to `on/off`, boolean, and `1/0`, covering firmware that accepts disable via `0` but requires full-range enable via `100`.

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

8. **[S8] Filter life drops to 4%**
   - **Given** `filter1_life` falls to replacement threshold.
   - **When** accessory state refresh runs.
   - **Then** `FilterChangeIndication` is set to `1` (`CHANGE_FILTER`).

9. **[S9] Filter replacement (4% -> 100%)**
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
