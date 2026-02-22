# Reliability and status test scenarios

This document describes how network/status resilience is tested and what behavior is guaranteed.

## Running tests

```bash
npm test
```

The current test suite executes `vitest run --coverage` and enforces full coverage.

## Power OFF mode-switch policy

When purifier power is OFF, mode switch writes are intentionally ignored. This avoids invalid mode writes while the purifier is not running and keeps HomeKit state synchronized by immediately refreshing characteristics from the latest device state.

## Automated scenarios (Given / When / Then)

All scenarios below are covered by automated Vitest tests in `test/network-scenarios.test.ts`, `test/reliability.test.ts`, and `test/accessory-platform-index.test.ts`.

1. **Purifier restart**
   - **Given** device connection drops during restart.
   - **When** the device responds again.
   - **Then** plugin reconnects, refreshes state, and logs recovery without Homebridge restart.

2. **Router Wi-Fi restart**
   - **Given** temporary LAN outage after initial synchronization.
   - **When** network path returns.
   - **Then** plugin retries with reconnect flow and resynchronizes HomeKit/device state.

3. **Packet loss / unstable network**
   - **Given** transient timeout/reset errors.
   - **When** polling and command refreshes execute.
   - **Then** retry/backoff occurs, warnings are logged, and plugin remains stable (no crash/flapping).

4. **Homebridge restart**
   - **Given** plugin initialization from clean process start.
   - **When** first device poll completes.
   - **Then** cached state is initialized correctly and expected characteristics are published.

5. **Plugin hot reload (disable/enable)**
   - **Given** plugin lifecycle `init -> shutdown`.
   - **When** shutdown completes.
   - **Then** timers are cleaned up and no polling interval leaks remain.

6. **Short Wi-Fi outage (5-30s equivalent)**
   - **Given** a brief DNS/network failure.
   - **When** connectivity returns quickly.
   - **Then** command path recovers and state is synchronized again.

7. **Long Wi-Fi outage (minutes equivalent)**
   - **Given** repeated unreachable network errors and exhausted retries.
   - **When** service eventually comes back.
   - **Then** process remains stable, warnings are emitted, and later writes/polls succeed.

8. **Filter life reaches 4%**
   - **Given** `filter1_life` drops below threshold.
   - **When** characteristic refresh runs.
   - **Then** `FilterChangeIndication` is set to `CHANGE_FILTER` (1).

9. **Filter replacement (4% -> 100%)**
   - **Given** filter warning is active.
   - **When** `filter1_life` returns to high value after replacement.
   - **Then** `FilterChangeIndication` transitions back to `FILTER_OK` (0).
