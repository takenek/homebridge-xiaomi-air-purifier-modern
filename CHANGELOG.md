# 1.0.0 (2026-05-05)


### Bug Fixes

* trigger initial npm release ([b5cc8f8](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/b5cc8f8137ae49dad32538d1b6a24b7bad0d7b1c))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Buzzer support** — completely removed buzzer switch, `enableBuzzerControl` config option, `setBuzzerVolume()` API method, `buzzer_volume` device state property, and all MIOT/legacy buzzer protocol mappings due to operational issues.

### Fixed

- **README configuration example** — updated from stale `"accessories"` / `"accessory"` pattern to correct Dynamic Platform Plugin format (`"platforms"` / `"platform"` with `devices` array). Matches the actual `registerPlatform` registration and `config.schema.json` layout.
- **Audit report stale references** — corrected `registerAccessory` → `registerPlatform`, updated test counts (126 tests), and marked platform migration as completed.

### Added

- **Filter status test scenarios** — S8 (filter life drops to 4% triggers `FilterChangeIndication = CHANGE_FILTER`) and S9 (filter replacement 4%→100% resets `FilterChangeIndication = FILTER_OK`) added to automated network/status scenario suite.

### Changed

- **Test suite reorganized** — split 2 oversized test files (1437 + 1073 LOC) into 5 focused, single-responsibility modules: `accessory.test.ts`, `platform.test.ts`, `config-validation.test.ts`, `miio-transport-protocol.test.ts`, `miio-transport-commands.test.ts`. 126 tests across 13 files, 100% coverage enforced.

## [1.0.0] — 2026-03-02

Initial public release.

### Added

- **Xiaomi Mi Air Purifier support** for models: 2H, 3, 3H, 4, Pro (`zhimi.airpurifier.*`).
- **Dual protocol engine** — automatic MIOT / Legacy MIIO detection with runtime fallback. Batch property reads for both protocols.
- **Homebridge 1.x and 2.x compatibility** — native `AirPurifier` service on HB 2.x with `Active`, `CurrentAirPurifierState` (including `IDLE`), `TargetAirPurifierState`, and `RotationSpeed`; `Switch` fallback on HB 1.x. Dynamic detection via `Reflect.get`.
- **Air Quality Sensor** — AQI mapped to HomeKit `AirQuality` enum (Excellent / Good / Fair / Poor / Inferior) with PM2.5 Density. Configurable via `enableAirQuality` (default `true`).
- **Temperature and Humidity sensors** — configurable via `enableTemperature` and `enableHumidity` (default `true`).
- **Child Lock switch** — optional, controlled by `enableChildLockControl` (default `false`).

- **LED Night Mode switch** — toggle LED indicator on/off.
- **Mode AUTO ON/OFF and Mode NIGHT ON/OFF switches** — dedicated mode controls with guard logic (writes ignored when power is OFF).
- **Filter Maintenance service** — `FilterLifeLevel` + `FilterChangeIndication` with configurable threshold (`filterChangeThreshold`, default `10`%).
- **Filter Replace Alert contact sensor** — optional extra HomeKit sensor for filter replacement visibility (`exposeFilterReplaceAlertSensor`, default `false`).
- **Exponential backoff with jitter** for reconnection — base 400 ms, configurable cap (`reconnectDelayMs`, default 15 s), 8 retries, 20% jitter. 16 retryable error codes including `ETIMEDOUT`, `ECONNRESET`, `ENETDOWN`, `EHOSTUNREACH`, `EAI_AGAIN`.
- **Operation queue** — serializes UDP commands to prevent race conditions.
- **Connection lifecycle events** — `connected` / `disconnected` / `reconnected` logged per device.
- **IP address masking** — `maskDeviceAddressInLogs` option for privacy-sensitive deployments.
- **Config validation** — strict 32-char hex token regex, supported model enum, timeout normalization with floor clamping.
- **Config schema** for Homebridge UI with 3 expandable sections (Sensors, Alerts & Controls, Privacy & Timing).
- **Zero runtime dependencies** — only `node:crypto` and `node:dgram`.
- **126 tests** across 10 test suites, 100% coverage enforced (statements, branches, functions, lines) via vitest v4 + v8 provider.
- **CI matrix** — Node 20/22/24 × Homebridge 1.11.2 / beta (2.x), with full and smoke lanes.
- **Supply chain security** — SBOM (CycloneDX), OSV Scanner, OpenSSF Scorecard, npm audit in CI, SHA-pinned GitHub Actions.
- **Semantic release** with `@semantic-release/changelog`, npm publish with provenance (`NPM_CONFIG_PROVENANCE`).
- **Dependabot** for npm and GitHub Actions (weekly).
- **Auto-labeling** for PRs (src, test, ci, docs, dependencies).
- **Full OSS documentation** — `LICENSE` (MIT), `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (with SLA), `RELEASE_CHECKLIST.md`, issue/PR templates, `CODEOWNERS`.

### Fixed

- Retryable MIOT fallback error masking — transport errors are now re-thrown for proper retry handling.
- MIIO transport `close()` idempotent — safe for restart paths and double-close races (`ERR_SOCKET_DGRAM_NOT_RUNNING` caught).
- State listener failures during polling — isolated with try/catch to prevent cascading errors.
- Socket error handler installed — prevents unhandled `error` event crash.
- Suppressed queue errors logged — rejected operations don't block the queue; errors surfaced via `logger.debug`.
- Shutdown rejection handled — `void client.shutdown().catch(...)` prevents unhandled promise crash.
- HomeKit service names explicit — all Switch services have unique display names and subtypes.
- `FilterChangeIndication` threshold boundary — uses `<=` comparison with configurable threshold.
- `led_b` legacy numeric encoding — `toLegacyLed()` correctly maps 0=bright, 1=dim, 2=off.
- MIOT batch read optimization — single `get_properties` call with fallback to per-property reads.
- `CurrentAirPurifierState.IDLE` — correctly reported when device mode is `idle`.

### Security

- Token never logged — verified across all log calls and error messages.
- IP masking — `maskAddress()` with propagation to `SerialNumber` characteristic.
- AES-128-CBC encryption — standard MIIO protocol encryption with MD5-derived key/IV.
- No command injection — JSON.stringify with typed parameters, no string interpolation in commands.
- `engine-strict=true` in `.npmrc`.
- `files` whitelist in `package.json` — only `dist`, `config.schema.json`, and documentation published.
- Workflow permissions follow principle of least privilege (`contents: read` default).
