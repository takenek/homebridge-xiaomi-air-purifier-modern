# Homebridge Plugin Audit Report v2

**Plugin:** `homebridge-xiaomi-air-purifier-modern` (v1.0.0)
**Repository:** `takenek/xiaomi-mi-air-purifier-ng`
**Auditor:** Claude (AI) — full independent re-audit
**Date:** 2026-02-25
**Scope:** Full code review, quality audit, Homebridge compliance, security, CI/CD, npm-readiness

---

## 1. Executive Summary

### Biggest Strengths

1. **100% test coverage** (excluding `miio-transport.ts` network layer) with 70 tests across 9 suites — enforced via thresholds in CI. Exceptional for the Homebridge ecosystem.
2. **Zero production dependencies** — only `node:crypto` and `node:dgram` are used for the MIIO protocol. This eliminates supply chain attack surface entirely.
3. **Professional architecture** — clean module separation (transport → client → mappers/policy → accessory), serialized operation queue, exponential backoff with jitter, proper resource cleanup on shutdown.
4. **Comprehensive CI/CD** — lint, typecheck, test (with coverage), build, and `npm audit` all run across Node 20/22/24. Release workflow publishes with npm provenance.
5. **Complete OSS documentation** — README (config, examples, troubleshooting), CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates — all present and well-written.
6. **Homebridge 1.x and 2.x compatibility** — both `engines` and `peerDependencies` correctly declare `^1.11.1 || ^2.0.0-beta.0`.

### Key Risks / Areas for Improvement

1. **Power is exposed as `Switch`, not as HAP `AirPurifier` service** — HomeKit has a native `AirPurifier` service with `Active`, `CurrentAirPurifierState`, `TargetAirPurifierState`, and `RotationSpeed`. Using `Switch` makes the device invisible to HomeKit automations that target "air purifiers" and loses the native UI.
2. **Dead code: `fanLevelToRotationSpeed` / `rotationSpeedToFanLevel` / `setFanLevel` / `setBuzzerVolume`** — exported, tested, but never wired to any HomeKit characteristic or handler.
3. **`miio-transport.ts` (648 lines) excluded from coverage** — the most complex and risk-prone module (protocol, crypto, UDP, session management) has zero regression safety net.
4. **Double decryption of every command response** — `sendAndReceive` decrypts the payload to match `id`, then `sendCommand` decrypts again. Minor performance cost per RPC.
5. **No `PM2_5Density` characteristic** — raw PM2.5 value is available but not exposed alongside the 5-level AirQuality mapping.

---

## 2. Critical Issues (Publication Blockers)

**None found.** All previous blockers (missing LICENSE, biome schema mismatch) have been resolved. The plugin is technically publishable now.

---

## 3. Important Improvements (Prioritized)

### HIGH Priority

#### HIGH-1: Consider migrating from `Switch` to native HAP `AirPurifier` service

- **Files:** `src/accessories/air-purifier.ts:48`, `config.schema.json:3`
- **Current state:** Power is exposed as `Service.Switch("Power")`. Mode switches are separate `Switch` services.
- **Problem:** HomeKit has a dedicated `AirPurifier` service (`Service.AirPurifier`) that provides:
  - `Active` (0/1) — maps directly to power on/off
  - `CurrentAirPurifierState` (Inactive/Idle/Purifying) — richer status
  - `TargetAirPurifierState` (Manual/Auto) — maps to mode
  - `RotationSpeed` (0–100%) — maps to fan_level 1–16 via the already-implemented `fanLevelToRotationSpeed`/`rotationSpeedToFanLevel`
- **Impact:**
  - The device would appear as a proper air purifier in Apple Home (dedicated icon, proper tile)
  - HomeKit automations targeting "air purifiers" would find it
  - `RotationSpeed` slider would appear natively
  - The existing `fanLevelToRotationSpeed`/`rotationSpeedToFanLevel` mappers would become actually used
- **Risk:** This is a breaking change for existing users (accessories would need to be re-added). Could be done in a 2.0 release.
- **Recommendation:** File as planned for v2.0.0. Current Switch-based approach works correctly for v1.0.0.

#### HIGH-2: Remove or wire dead code

- **Files:**
  - `src/core/mappers.ts:6-17` — `fanLevelToRotationSpeed`, `rotationSpeedToFanLevel` exported but never imported outside tests
  - `src/core/device-client.ts:99-101` — `setFanLevel()` public method never called from any HomeKit handler
  - `src/core/device-client.ts:115-117` — `setBuzzerVolume()` public method never called
- **Problem:** These are fully tested and working code paths that serve no purpose in the current plugin. This creates confusion for contributors ("where is fan speed control?") and bloats coverage reports.
- **Options:**
  1. **Remove** them to eliminate dead code (simplest)
  2. **Wire them** to HomeKit characteristics (requires HIGH-1 or additional Switch services)
  3. **Mark as `@internal`/document** that they're API surface for future use
- **Recommendation:** Option 3 if HIGH-1 (AirPurifier service) is planned; Option 1 otherwise.

#### HIGH-3: `miio-transport.ts` coverage exclusion

- **File:** `vitest.config.ts:10`
- **Problem:** The most complex module (648 lines: protocol framing, AES-128-CBC crypto, UDP session management, MIOT/legacy auto-detection, batch/per-property fallback) is entirely excluded from coverage.
- **What IS tested:** Several reliability tests in `miio-transport-reliability.test.ts` spy on internal methods — these provide integration-level confidence but don't count toward coverage.
- **What's safely testable without real UDP:**
  - `encrypt`/`decrypt` round-trip with known test vectors
  - `trySetViaMiot` parameter mapping for all methods (mock `call`)
  - `readViaMiot`/`readViaLegacy` state assembly (already partially tested)
  - Handshake packet construction (pure Buffer logic)
  - `detectProtocolMode` branching (mock `call`)
  - `MiioCommandError` classification
  - `isTransportError` logic
- **Recommendation:** Extract pure/testable logic into separate functions or test via the existing spy-based approach, then narrow the coverage exclusion to just `sendAndReceive` and `handshake`.

### MEDIUM Priority

#### MED-1: Double decryption of command responses

- **File:** `src/core/miio-transport.ts:616-627,547-558`
- **Flow:** `sendAndReceive()` decrypts the payload at line 619 to match `parsed.id !== expectedResponseId`, then `sendCommand()` decrypts again at line 552 to extract the actual result.
- **Impact:** Two AES-128-CBC decryptions per command. For the polling frequencies used (10s/30s), this is negligible, but it's architecturally wasteful.
- **Fix:** Have `sendAndReceive` return both the raw buffer and the pre-parsed payload when `expectEncrypted` is true, or cache the decrypted result.

#### MED-2: Expose raw PM2.5 as `PM2_5Density` characteristic

- **File:** `src/accessories/air-purifier.ts`
- **Current:** Only the 5-level `AirQuality` enum is exposed.
- **Problem:** HomeKit's `AirQualitySensor` supports `PM2_5Density` (numeric μg/m³) which can be displayed alongside the qualitative level. The raw value is already available in `state.aqi`.
- **Fix:**
  ```ts
  this.airQualityService
    .getCharacteristic(Char.PM2_5Density)
    .onGet(() => this.client.state?.aqi ?? 0);
  ```
  And in `refreshCharacteristics`:
  ```ts
  this.updateCharacteristicIfNeeded(
    this.airQualityService,
    this.api.hap.Characteristic.PM2_5Density,
    state.aqi,
  );
  ```

#### MED-3: `operationPollIntervalMs` and `sensorPollIntervalMs` missing from README config table

- **File:** `README.md`
- **Current:** These fields are in `config.schema.json` and mentioned in the "Polling and reconnect" section, but absent from the main Configuration fields table.
- **Fix:** Add them to the table.

#### MED-4: MIOT mode fallback value `3` is undocumented

- **File:** `src/core/miio-transport.ts:436`
- **Code:** `const value = mode === "auto" ? 0 : mode === "sleep" ? 1 : mode === "favorite" ? 2 : 3;`
- **Problem:** MIOT mode value `3` is used as a catch-all fallback. For most Xiaomi models, 3 = "manual" mode. However, if an unexpected mode string arrives, it silently sends `3` to the device.
- **Recommendation:** Log a debug warning for unexpected mode values, or constrain the type more narrowly.

#### MED-5: No PR template

- **File:** `.github/PULL_REQUEST_TEMPLATE.md` (missing)
- **Problem:** Issue templates exist (bug + feature), but there's no PR template. For OSS contributions, a PR template ensures consistent descriptions.
- **Fix:** Add a minimal template:
  ```markdown
  ## Summary
  <!-- Brief description of changes -->

  ## Test plan
  - [ ] `npm run check` passes locally
  - [ ] CHANGELOG updated (if user-visible change)
  ```

### LOW Priority

#### LOW-1: `RELEASE_CHECKLIST.md` mentions manual `npm publish`

- **File:** `RELEASE_CHECKLIST.md:11`
- **Problem:** Step "Publish package (`npm publish --access public`)" is redundant — the release workflow handles this automatically when a tag is pushed. The checklist also lists "Create GitHub Release" which is also automated.
- **Fix:** Remove the manual publish/release steps and note that they're automated by CI.

#### LOW-2: `ContactSensorState` semantics may confuse users

- **File:** `src/accessories/air-purifier.ts:208-214`
- **Current:** `CONTACT_DETECTED` (1) = filter needs replacement, `CONTACT_NOT_DETECTED` (0) = OK.
- **Problem:** The semantic mapping is counter-intuitive: "contact detected" suggests something physical touching the sensor. This is a known HomeKit limitation (no "alert" sensor type), and it's already documented in `docs/reliability-testing.md`.
- **Action:** No code change needed, but consider adding a brief note in the README's Filter section.

#### LOW-3: `toNumber` accepts `"Infinity"` strings as 0

- **File:** `src/core/miio-converters.ts:11-13`
- **Code:** `Number.isFinite(parsed) ? parsed : 0` — correctly rejects `Infinity`/`-Infinity`/`NaN`.
- **Action:** No change needed — this is correct behavior, noting it here for completeness.

#### LOW-4: Consider Dependabot grouping for dev dependencies

- **File:** `.github/dependabot.yml`
- **Current:** All npm updates create individual PRs.
- **Suggestion:** Group minor/patch dev dependency updates:
  ```yaml
  groups:
    dev-dependencies:
      patterns: ["*"]
      update-types: ["minor", "patch"]
  ```
  This reduces PR noise since all 5 devDependencies are updated weekly.

---

## 4. Detailed Analysis

### 4.1 Project Structure Assessment

```
src/
├── index.ts                     # 6 lines — entry point, registerAccessory
├── platform.ts                  # 140 lines — config validation, wiring
├── accessories/
│   └── air-purifier.ts          # 313 lines — HomeKit service/characteristic setup
└── core/
    ├── device-client.ts         # 276 lines — operation queue, polling, retry, lifecycle
    ├── miio-transport.ts        # 648 lines — MIIO/MIOT protocol, UDP, crypto
    ├── mappers.ts               # 41 lines — pure value mappers
    ├── miio-converters.ts       # 38 lines — type converters
    ├── mode-policy.ts           # 28 lines — mode switch resolution
    ├── retry.ts                 # 57 lines — backoff/retry policy
    └── types.ts                 # 48 lines — shared interfaces

test/
├── accessory-platform-index.test.ts    # 944 lines — comprehensive accessory + platform tests
├── device-api.test.ts                  # 89 lines — DeviceClient read/write API
├── device-client-branches.test.ts      # 485 lines — edge cases, queue recovery, retry
├── mappers.test.ts                     # 43 lines — value mapping
├── miio-converters.test.ts             # 73 lines — type conversion
├── miio-transport-reliability.test.ts  # 367 lines — transport reliability (spy-based)
├── mode-policy.test.ts                 # 34 lines — mode switch logic
├── network-scenarios.test.ts           # 208 lines — real-world network failure scenarios
└── reliability.test.ts                 # 172 lines — retry, backoff, socket error handling
```

**Total:** ~1,595 lines of source code, ~2,415 lines of tests (1.51:1 test-to-code ratio). Excellent.

**Architecture quality:** Clean SRP boundaries. No god objects. Each module is independently testable. The dependency graph flows one way: `index → platform → accessory → device-client → transport`.

### 4.2 Homebridge 1.x / 2.x Compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| Accessory registration | **PASS** | `api.registerAccessory()` in `index.ts` |
| `getServices()` returns services | **PASS** | Returns array of HAP services |
| Shutdown handler | **PASS** | `api.on("shutdown", ...)` clears timers, closes socket |
| Config validation at startup | **PASS** | Throws on invalid token/name/address/model |
| `config.schema.json` | **PASS** | Well-structured with layout hints for Config UI X |
| `pluginAlias` matches code | **PASS** | `"XiaomiMiAirPurifier"` ↔ `ACCESSORY_NAME` |
| `pluginType` | **PASS** | `"accessory"` — correct for single-device plugins |
| `peerDependencies` | **PASS** | `"homebridge": "^1.11.1 \|\| ^2.0.0-beta.0"` |
| `engines.homebridge` | **PASS** | Matches peerDependencies |
| `engines.node` | **PASS** | `"^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0"` |
| Logging levels | **PASS** | `debug` for internal, `info` for connections, `warn` for errors |
| No sensitive data in logs | **PASS** | Token is never logged |
| `_bridge` child bridge support | **PASS** | Documented in README |
| HAP Service naming | **PASS** | Subtype strings prevent UUID collisions |
| `ConfiguredName` support | **PASS** | Defensive check with fallback for older HAP |
| Characteristic caching (dedup) | **PASS** | `characteristicCache` prevents redundant pushes |
| `onGet` handlers | **PASS** | All readable characteristics have `onGet` with safe defaults |
| Timer cleanup (`.unref()`) | **PASS** | All `setInterval` timers call `.unref()` |
| `nextMessageId` overflow protection | **PASS** | Wraps at `0x7FFFFFFF` |

**Compliance Score: 18/18 — Excellent**

### 4.3 Code Quality Assessment

#### Async/Await Patterns (Excellent)

- `DeviceClient.enqueueOperation()` implements a correctly serialized promise queue preventing race conditions between polling and user-initiated commands.
- All async errors are caught and logged — no unhandled promise rejections.
- `void this.client.init().then(...).catch(...)` pattern in the constructor correctly handles fire-and-forget initialization.
- `delay()` method respects `destroyed` flag to avoid unnecessary waits during shutdown.
- `retryDelayResolve` is resolved on shutdown to unblock pending retry delays.

#### Error Handling (Excellent)

- Transport errors are classified as retryable vs non-retryable using error codes.
- `RETRYABLE_ERROR_CODES` is comprehensive: 17 codes covering timeout, reset, DNS, network unreachable, socket errors.
- `isRetryableError` correctly handles non-Error values and missing codes.
- Connection/state listeners are wrapped in try/catch to isolate failures.
- `MiioCommandError` distinguishes protocol-level errors from transport errors.
- The `call()` method implements automatic handshake retry on transport errors — good resilience pattern.

#### Resource Management (Excellent)

- All 3 `setInterval` timers + 1 `setTimeout` timer tracked and cleared in `clearTimers()`.
- `.unref()` on all interval timers prevents blocking Node.js shutdown.
- `retryDelayResolve` is resolved on shutdown to prevent hanging promises.
- UDP socket closed with `ERR_SOCKET_DGRAM_NOT_RUNNING` handling for idempotent close.
- `destroyed` flag prevents new operations after shutdown.
- `sendAndReceive` cleans up event listeners on timeout, message receipt, and error.

#### TypeScript Strictness (Excellent)

`tsconfig.json` enables the strictest practical configuration:
- `strict: true` (includes `strictNullChecks`, `strictFunctionTypes`, etc.)
- `noImplicitAny: true`
- `noUnusedLocals` / `noUnusedParameters`
- `noUncheckedIndexedAccess: true` — catches missing index checks
- `exactOptionalPropertyTypes: true` — prevents `undefined` assignment to optional props

Biome enforces `noExplicitAny: "error"` — zero escape hatches for `any` type.

#### Protocol Implementation (Very Good)

- MIIO protocol implementation is correct: magic bytes, device ID, stamp, checksum, AES-128-CBC.
- Auto-detection of MIOT vs legacy protocol with graceful fallback.
- Batch MIOT `get_properties` with per-property fallback for devices that don't support batch.
- Multiple candidate property IDs for fan_level, temperature, humidity, AQI — handles model variations.
- `corePropertiesUnavailableError` with custom error code for proper retry classification.

### 4.4 Security Audit

| Check | Status | Details |
|-------|--------|---------|
| Token not logged | **PASS** | Grep confirms token never appears in log output |
| Token not stored beyond config | **PASS** | Only in Homebridge's `config.json` (standard practice) |
| AES-128-CBC encryption | **PASS** | Standard MIIO protocol via `node:crypto` |
| No external network calls | **PASS** | UDP only to device IP on LAN port 54321 |
| No `eval`/`Function` constructor | **PASS** | No dynamic code execution |
| No `child_process` usage | **PASS** | Only `node:crypto` and `node:dgram` |
| No runtime dependencies | **PASS** | **Zero production dependencies** — gold standard |
| `npm audit` clean | **PASS** | 0 vulnerabilities |
| Lock file present | **PASS** | `package-lock.json` committed |
| Provenance on publish | **PASS** | `npm publish --provenance` in release workflow |
| `id-token: write` permission | **PASS** | Correctly scoped for npm provenance |
| `contents: write` permission | **NOTE** | Needed for GitHub release creation |
| `.npmrc` engine-strict | **PASS** | `engine-strict=true` |
| JSON.parse error handling | **PASS** | Try/catch on MIIO response parsing (`miio-transport.ts:556`) |
| UDP source validation | **NOTE** | `sendAndReceive` accepts any MIIO-magic message on the socket, not filtered by source IP. Negligible LAN risk. |

**Security Score: Excellent**

### 4.5 Tests and CI/CD

#### Test Quality

| Metric | Value |
|--------|-------|
| Test files | 9 |
| Total tests | 70 |
| Coverage (lines/branches/functions/statements) | **100%** (miio-transport.ts excluded) |
| Threshold enforcement | Yes, in `vitest.config.ts` |
| Test runner | Vitest v4.0 with v8 coverage |
| Fake timers | Yes, for polling/retry tests |
| Fake transports | 4 variants (FakeTransport, BranchTransport, ScriptedTransport, FlakyTransport) |
| Network scenario tests | 7 named scenarios (S1–S7) |
| Edge case coverage | Non-Error rejections, listener failures, queue recovery, pre-rejected queues |

**Test highlights:**
- `ScriptedTransport` pattern for simulating ordered failure/success sequences — well-designed
- Extensive coverage of error branches, including non-Error string rejections
- Deterministic timer testing with `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()`
- Filter threshold toggle tests (crossing above and below threshold)
- ConfiguredName presence/absence tested

#### CI/CD Quality

| Pipeline Step | Status | Matrix | Notes |
|---------------|--------|--------|-------|
| `npm audit --audit-level=high` | **PASS** | Node 20 | Security check |
| Lint (Biome) | **PASS** | Node 20/22/24 | `biome check .` |
| Typecheck (tsc) | **PASS** | Node 20/22/24 | `--noEmit` |
| Test + coverage | **PASS** | Node 20/22/24 | Coverage artifacts uploaded |
| Build (tsc) | **PASS** | Node 20/22/24 | + `npm pack --dry-run` |
| Release publish | **PASS** | Node 22 | Tag-triggered, provenance, GH release |
| Dependabot | **PASS** | npm (weekly, 10 PRs) + Actions (weekly, 5 PRs) |

**CI highlights:**
- `npm pack --dry-run` in build job validates package contents
- Coverage artifacts uploaded for each Node version
- Build artifact (dist/) uploaded per Node version
- Release workflow runs tests before publish

### 4.6 Package Analysis

```
Package: homebridge-xiaomi-air-purifier-modern@1.0.0
Size:    19.2 kB (packed) / 75.7 kB (unpacked)
Files:   26 (dist + config.schema.json + docs)

Runtime dependencies:  0
Dev dependencies:      5 (@biomejs/biome, @types/node, @vitest/coverage-v8, homebridge, typescript, vitest)

npm audit: 0 vulnerabilities
```

**`files` array review:** `["dist", "config.schema.json", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE"]` — clean, no source code or tests published. All declared files exist.

---

## 5. Homebridge Compatibility Score

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Registration & lifecycle | 5 | 5 | Perfect |
| Config validation & schema | 5 | 5 | Thorough with defaults & clamping |
| Service/Characteristic mapping | 3.5 | 5 | Works correctly, but Switch instead of AirPurifier service |
| Connection resilience | 5 | 5 | Retry, backoff, reconnect, lifecycle events |
| Logging practices | 5 | 5 | Proper levels, no sensitive data |
| Node/Homebridge version compat | 5 | 5 | 20/22/24 + HB 1.x/2.x |
| **Total** | **28.5** | **30** |

**-1.5 points** for using `Switch` instead of native `AirPurifier` service (HIGH-1). Functionally correct but not the idiomatic HomeKit approach.

---

## 6. "Ready for npm?" Checklist

| Item | Status |
|------|--------|
| `LICENSE` file | **PRESENT** — MIT |
| `README.md` (config, examples, troubleshooting) | **PRESENT** — comprehensive |
| `CHANGELOG.md` | **PRESENT** — Keep a Changelog format |
| `CONTRIBUTING.md` | **PRESENT** — Conventional Commits documented |
| `CODE_OF_CONDUCT.md` | **PRESENT** — Contributor Covenant 2.1 |
| `SECURITY.md` | **PRESENT** — private reporting process |
| Issue templates (bug + feature) | **PRESENT** |
| PR template | **MISSING** — see MED-5 |
| `config.schema.json` | **PRESENT** — well-structured with layout |
| `package.json` — name | **PRESENT** — `homebridge-xiaomi-air-purifier-modern` |
| `package.json` — keywords | **PRESENT** — `homebridge-plugin`, `homebridge`, `xiaomi`, `air-purifier`, `homekit` |
| `package.json` — homepage | **PRESENT** |
| `package.json` — repository | **PRESENT** |
| `package.json` — bugs | **PRESENT** |
| `package.json` — license | **PRESENT** — `"MIT"` |
| `package.json` — author | **PRESENT** — `"TaKeN"` |
| `package.json` — engines | **PRESENT** — Node + Homebridge |
| `package.json` — peerDependencies | **PRESENT** — Homebridge |
| `package.json` — files | **PRESENT** — dist + docs |
| `package.json` — main | **PRESENT** — `dist/index.js` |
| `package.json` — types | **PRESENT** — `dist/index.d.ts` |
| `tsconfig.json` (strict) | **PRESENT** |
| Linter (Biome) | **PRESENT** — recommended + noExplicitAny |
| Formatter (Biome) | **PRESENT** — 2-space indent, 100 cols |
| `.editorconfig` | **PRESENT** |
| `.gitignore` | **PRESENT** |
| `.npmrc` (engine-strict) | **PRESENT** |
| `package-lock.json` | **PRESENT** |
| Build output (`dist/`) | **PASS** — compiles cleanly |
| `npm pack` sanity | **PASS** — 26 files, 19.2 kB |
| `npm audit` | **PASS** — 0 vulnerabilities |
| CI pipeline | **PASS** — lint/typecheck/test/build/audit |
| Release workflow | **PRESENT** — tag-triggered npm publish with provenance |
| Dependabot | **PRESENT** — npm + GitHub Actions |

**Verdict: Ready for npm.** No publication blockers. One minor gap (PR template).

---

## 7. Summary of Recommended Actions

### v1.0.0 Polish (Before or Soon After Publish)

| # | Priority | Finding | Effort |
|---|----------|---------|--------|
| 1 | HIGH | Remove dead code (`fanLevelToRotationSpeed`, `rotationSpeedToFanLevel`, `setFanLevel`, `setBuzzerVolume`) or document as future API | Small |
| 2 | HIGH | Add targeted tests for `miio-transport.ts` testable logic to narrow coverage gap | Medium |
| 3 | MED | Add `PM2_5Density` characteristic to `AirQualitySensor` | Small |
| 4 | MED | Add `operationPollIntervalMs` / `sensorPollIntervalMs` to README config table | Trivial |
| 5 | MED | Add PR template (`.github/PULL_REQUEST_TEMPLATE.md`) | Trivial |
| 6 | MED | Fix double decryption in `sendAndReceive` → `sendCommand` flow | Small |
| 7 | LOW | Update `RELEASE_CHECKLIST.md` to remove manual publish/release steps | Trivial |
| 8 | LOW | Add Dependabot grouping for dev dependencies | Trivial |

### v2.0.0 Roadmap (Breaking Change)

| # | Priority | Finding | Effort |
|---|----------|---------|--------|
| 9 | HIGH | Migrate from `Switch` to native HAP `AirPurifier` service with RotationSpeed | Large |
| 10 | MED | Consider platform plugin for multi-device support | Large |

---

## 8. Final Assessment

This is an **exceptionally well-built Homebridge plugin** that demonstrates professional-grade engineering across every dimension: architecture, TypeScript strictness, test coverage, CI/CD, documentation, and security. The zero-dependency approach is particularly noteworthy — it eliminates the most common vulnerability vector in the npm ecosystem.

The main architectural trade-off is the use of `Switch` services instead of the native HAP `AirPurifier` service. While this simplifies the implementation and works correctly, it means the device doesn't appear as a "proper" air purifier in HomeKit. This is the most impactful improvement for a future version.

The codebase is clean, well-organized, and thoroughly tested. All previous audit findings (LICENSE, biome version, onGet handlers, timer unref, nextMessageId overflow, config schema) have been resolved. There are no publication blockers.

**Overall Quality Rating: 9.3 / 10**

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Code quality | 9/10 | Minor dead code, double decrypt |
| Architecture | 9.5/10 | Excellent separation, Switch vs AirPurifier trade-off |
| Test coverage | 9/10 | 100% enforced, miio-transport excluded |
| CI/CD | 9.5/10 | Comprehensive matrix, provenance, audit |
| Documentation | 9/10 | Missing PR template, minor README gap |
| Security | 10/10 | Zero deps, no sensitive data leaks, provenance |
| Homebridge compliance | 9/10 | All checks pass, Switch instead of AirPurifier |
| npm readiness | 10/10 | All checklist items present |
