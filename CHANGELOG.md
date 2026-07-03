# Changelog

All notable changes to this project are documented in this file. Version headers and the per-commit bullets below are generated automatically by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) on every merge to `main`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.4...v1.0.5) (2026-06-02)


### Bug Fixes

* prefix all device log lines with the configured device name ([#206](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/206)) ([d34005c](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/d34005cb8f867c837a547f028a3182374b0915dc))

## [1.0.4](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.3...v1.0.4) (2026-05-20)


### Bug Fixes

* correct Homebridge config UI setup layout ([9c91045](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/9c91045b3705f38636198cd86ee1f5194c3c4cc6))

## [1.0.3](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.2...v1.0.3) (2026-05-12)


### Bug Fixes

* auto-recover MIIO transport from -5001 stuck state, drop HB 1.x fallback ([0e9824c](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/0e9824ccc2d0593b3c4f392ee854520e684e266a))

## [1.0.2](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.1...v1.0.2) (2026-05-06)


### Bug Fixes

* **platform:** report device index, name and missing fields when validating config ([05e187c](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/05e187c8b0772da73b383d95b8e9480db43dbb2a))

## [1.0.1](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.0...v1.0.1) (2026-05-05)


### Bug Fixes

* replace slash in ConfiguredName to satisfy HAP-NodeJS validation ([73c36e1](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/73c36e1ba641eec0fdfbf22f24b1710f55217d5e))

## [1.0.0] (2026-05-05)

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
