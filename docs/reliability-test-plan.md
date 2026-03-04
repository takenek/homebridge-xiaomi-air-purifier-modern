# Reliability and status test plan

This plugin uses automated Vitest scenarios to validate reconnect behavior and HomeKit state synchronization.

## Strategy for mode switches while power is OFF

When purifier power is OFF, mode switches are not exposed as independently available controls.
State reconciliation keeps HomeKit characteristics aligned with the single source of truth (`DeviceClient.state`) and avoids creating extra switch accessories in OFF state transitions.

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

## Buzzer control on zhimi.airpurifier.pro

The `zhimi.airpurifier.pro` model does not support buzzer control. The plugin enforces this at two levels:

1. **Schema level** — `enableBuzzerControl` is intentionally excluded from `config.schema.json` properties and layout. Homebridge-config-ui-x does not reliably evaluate `condition`/`functionBody` for `pluginType: "accessory"` schemas, so the only guaranteed way to prevent the option from appearing in the Homebridge UI for the pro model is to remove it from the schema entirely. Users of non-pro models who want buzzer control can add `"enableBuzzerControl": true` directly in their JSON config.
2. **Runtime level** — `platform.ts` force-disables `enableBuzzerControl` when `model === 'zhimi.airpurifier.pro'` and logs a warning if the user explicitly set it to `true` in JSON config.

## How to run

```bash
env -u npm_config_http_proxy -u npm_config_https_proxy npm exec biome check .
env -u npm_config_http_proxy -u npm_config_https_proxy npm exec -- vitest --coverage
```
