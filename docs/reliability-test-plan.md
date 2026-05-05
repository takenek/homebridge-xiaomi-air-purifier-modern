# Reliability and status test plan

This plugin uses automated Vitest scenarios to validate reconnect behavior and HomeKit state synchronization.

## Platform Plugin v2.0 migration

As of this version, the plugin has been migrated from an **Accessory Plugin** to a **Dynamic Platform Plugin** (v2.0):

- **Registration**: Uses `api.registerPlatform()` instead of `api.registerAccessory()`.
- **Configuration**: Devices are configured via a `devices` array in the platform config (see `config.schema.json`).
- **Accessory lifecycle**: Uses `PlatformAccessory` with `configureAccessory()` for cached accessory recovery.
- **Service management**: Services are added to `PlatformAccessory` via `getOrAddService()`, which reuses existing services on cached accessories and removes stale ones when features change.
- **Multiple devices**: The platform supports multiple air purifiers in a single plugin instance.

### Config migration (Accessory → Platform)

**Before** (accessory config in `config.json`):
```json
{
  "accessory": "XiaomiMiAirPurifier",
  "name": "Air Purifier",
  "address": "192.168.1.100",
  "token": "00112233445566778899aabbccddeeff",
  "model": "zhimi.airpurifier.3h"
}
```

**After** (platform config in `config.json`):
```json
{
  "platform": "XiaomiMiAirPurifier",
  "devices": [
    {
      "name": "Air Purifier",
      "address": "192.168.1.100",
      "token": "00112233445566778899aabbccddeeff",
      "model": "zhimi.airpurifier.3h"
    }
  ]
}
```

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
   - **Then** accessory state is initialized deterministically from current device values. Cached accessories are restored via `configureAccessory()` and updated with current state.

5. **[S5] Plugin restart (disable/enable, hot reload)**
   - **Given** init/shutdown cycle repeats.
   - **When** plugin is shut down and started again.
   - **Then** timers are cleaned up (no leaks), stale services are removed from platform accessories, and accessory lifecycle remains stable (no duplicate behavior).

6. **[S6] Short Wi-Fi outage (5-30s class)**
   - **Given** transient DNS/network error (`EAI_AGAIN`).
   - **When** connection returns quickly.
   - **Then** plugin restores state rapidly and continues normal operation.

7. **[S7] Long Wi-Fi outage (minutes class)**
   - **Given** repeated network-down responses that exceed immediate retry budget.
   - **When** polling continues and network later recovers.
   - **Then** plugin stays alive, logs degraded state, and fully resynchronizes on successful command/status call.

8. **[S8] Filter life drops to 4%**
   - **Given** `filter1_life` falls to replacement threshold (e.g. 4%).
   - **When** accessory state refresh runs.
   - **Then** `FilterChangeIndication` is set to `1` (`CHANGE_FILTER`).

9. **[S9] Filter replacement (4% -> 100%)**
   - **Given** filter replacement is completed and `filter1_life` returns to 100.
   - **When** next state refresh runs.
   - **Then** `FilterChangeIndication` is reset from `1` to `0` (`FILTER_OK`).

## How to run

```bash
npm run lint          # biome check
npm run typecheck     # tsc --noEmit
npm test              # vitest run --coverage (requires 100% thresholds)
```
