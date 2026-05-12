## [1.0.2](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.1...v1.0.2) (2026-05-06)


### Bug Fixes

* **platform:** report device index, name and missing fields when validating config ([05e187c](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/05e187c8b0772da73b383d95b8e9480db43dbb2a))

## [1.0.1](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/compare/v1.0.0...v1.0.1) (2026-05-05)


### Bug Fixes

* replace slash in ConfiguredName to satisfy HAP-NodeJS validation ([73c36e1](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/73c36e1ba641eec0fdfbf22f24b1710f55217d5e))

# 1.0.0 (2026-05-05)


### Bug Fixes

* trigger initial npm release ([b5cc8f8](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/commit/b5cc8f8137ae49dad32538d1b6a24b7bad0d7b1c))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Notes below are human-authored summaries of pending work on `main`. The
> machine-generated version header (`## [x.y.z]`) and per-commit bullet list
> are added by [semantic-release](https://semantic-release.gitbook.io/) on
> the next merge to `main`, based on conventional commit messages.

### Changed (BREAKING)

- **Homebridge 2.0.2 is now the minimum supported version.** `engines.homebridge` and `peerDependencies.homebridge` were tightened from `^1.11.1 || ^2.0.0` to `^2.0.2`. The Homebridge 1.x `Switch` fallback path in `accessories/air-purifier.ts` was removed — the native HomeKit `AirPurifier` service (`Active`, `CurrentAirPurifierState`, `TargetAirPurifierState`, `RotationSpeed`) is now mandatory. Users on Homebridge 1.x must stay on plugin v1.0.2 or upgrade Homebridge.
- **Node.js 20 dropped (end-of-life).** Supported runtimes are now **Node 22.x** and **Node 24.x** only. CI matrix updated accordingly.
- **CI matrix simplified to Homebridge 2.0.2** stable on Node 22 / 24. The `beta` (HB 2.x pre-release) lane was removed because Homebridge 2.0 is generally available.

### Added

- **Automatic transport recovery for stuck device-side state.** After `transportResetThreshold` (default `12`) consecutive failed polls, the plugin now recreates the underlying UDP socket, MIIO session, protocol-mode cache and message-id counter — the same effect as restarting Homebridge — so the plugin recovers without operator intervention. A `transportResetCooldownMs` (default `5 min`) prevents thrashing when the device is genuinely offline. Diagnostic warning is logged on each reset (`Persistent device errors (...) — recreating MIIO transport`).
- **`MIIO error -5001` and `-10000` are now classified as retryable** (with a hard cap of 2 retries per call). These device-side command errors used to fail immediately on the first attempt and could keep the connection stuck for hours on older firmware (notably `zhimi.airpurifier.pro`); they now go through the standard retry path and trigger the auto-reset above when persistent.
- **Defensive re-handshake on recoverable MIIO command errors.** `ModernMiioTransport.call()` now also rebuilds its session after `-5001`/`-10000`, not only after transport-level errors — a fresh handshake / `deviceStamp` clears most stuck states reported by older firmware.
- **New per-device config options** (also exposed in Homebridge UI via `config.schema.json`): `transportResetThreshold` (default `12`, set `0` to disable), `transportResetCooldownMs` (default `300000`).

### Removed

- **Homebridge 1.x `Switch` fallback** in `accessories/air-purifier.ts` — `getOptionalProperty(Service, "AirPurifier")` branch and `usesNativePurifierService` flag are gone.
- **Buzzer support** — completely removed buzzer switch, `enableBuzzerControl` config option, `setBuzzerVolume()` API method, `buzzer_volume` device state property, and all MIOT/legacy buzzer protocol mappings due to operational issues.

### Fixed

- **Device-config diagnostics** — failing entries in the `devices` array are now logged with their position (`#4`) and quoted name (`"Air Purifier"`) plus the concrete missing or invalid fields (`missing required config fields: address, token, model`). Previously the platform reported a single generic `Invalid or missing config field: address` line that could not be traced back to a specific entry. Address validation now uses `net.isIP()` (IPv4 only), all required string fields are trimmed before validation so whitespace-only values are treated as missing, and tokens are never included in any log output.
- **README configuration example** — updated from stale `"accessories"` / `"accessory"` pattern to correct Dynamic Platform Plugin format (`"platforms"` / `"platform"` with `devices` array). Matches the actual `registerPlatform` registration and `config.schema.json` layout.
- **Audit report stale references** — corrected `registerAccessory` → `registerPlatform`, updated test counts (126 tests), and marked platform migration as completed.

### Changed

- **`config.schema.json` strict validation** — added top-level `strictValidation: true`, declared `additionalProperties: false` on each `devices[]` item, and explicitly allowed `platform`, `name`, and `_bridge` at the schema root so Homebridge UI accepts both top-level and child-bridge configurations. The schema no longer ships a default value for `devices[].name` so an "Add Device" button click cannot persist a half-filled entry that is missing `address`, `token`, and `model`.
- **Test suite reorganized** — split 2 oversized test files (1437 + 1073 LOC) into focused, single-responsibility modules; **160 tests across 13 files, 100% coverage enforced** (statements/branches/functions/lines).
- **`homebridge` (devDependency) bumped from `1.11.4` to `2.0.2`.**

### Tests added in this cycle

- Filter status scenarios S8 / S9 (filter life drop / replacement) in the automated network/status scenario suite.
- Transport auto-reset path: threshold trigger, cooldown enforcement, threshold-disable, reset-failure handling (Error + non-Error), counter reset on successful poll.
- `ModernMiioTransport.reset()` — happy path, `ERR_SOCKET_DGRAM_NOT_RUNNING` swallow, non-Error throw.
- `-5001` / `-10000` classified as retryable + capped retries; `shouldRehandshake` true for `-5001`, false for unknown command codes.

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
