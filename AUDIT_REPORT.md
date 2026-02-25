# Homebridge Plugin Audit Report

**Plugin:** `homebridge-xiaomi-air-purifier-modern` (v1.0.0)
**Repository:** `takenek/xiaomi-mi-air-purifier-ng`
**Auditor:** Claude (AI)
**Date:** 2026-02-25
**Scope:** Full code review, quality audit, Homebridge compliance, security, CI/CD, npm-readiness

---

## 1. Executive Summary

### Biggest Strengths

1. **100% test coverage** (excluding `miio-transport.ts` network layer) with 60 tests across 8 suites — this is exceptional for a Homebridge plugin. Coverage thresholds are enforced in CI.
2. **Professional-grade architecture**: clean module separation (transport / client / mappers / policy / accessory), serialized operation queue, proper retry with exponential backoff + jitter, and correct resource cleanup on shutdown.
3. **Robust CI/CD pipeline**: lint, typecheck, test, build, and audit all run across Node 20/22/24. Release workflow publishes to npm with provenance.
4. **Comprehensive OSS documentation**: README with full config reference and troubleshooting, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates — all present and well-written.
5. **Zero production dependencies**: the plugin uses only Node.js built-ins (`node:crypto`, `node:dgram`) for MIIO protocol, eliminating supply chain attack surface entirely.
6. **Homebridge 1.x and 2.x compatibility**: both `engines` and `peerDependencies` correctly declare `^1.11.1 || ^2.0.0-beta.0`.

### Biggest Risks

1. **Missing LICENSE file**: `package.json` declares `"license": "MIT"` and the `files` array includes `"LICENSE"`, but no `LICENSE` file exists in the repository root. **This is a publication blocker** — npm warns about missing license, and users cannot legally use the code.
2. **Biome schema version mismatch**: `biome.json` references schema `2.4.4` but installed `@biomejs/biome` is `2.4.3`. This produces an info diagnostic in CI. Minor, but should be fixed for cleanliness.
3. **`miio-transport.ts` is excluded from coverage**: this is the most complex and risk-prone file (677 lines of protocol, crypto, and UDP networking). While unit-testing raw UDP is hard, the exclusion means the most critical path is untested for regressions.

---

## 2. Critical Issues (Publication Blockers)

### CRIT-1: Missing LICENSE file

- **Severity:** Critical / Blocker
- **Location:** Repository root
- **Problem:** `package.json` lists `"LICENSE"` in the `files` array, `"license": "MIT"` is declared, but no `LICENSE` or `LICENSE.md` file exists. `npm pack --dry-run` does not include it. Without a license file, the package is effectively "all rights reserved" regardless of `package.json` metadata.
- **Fix:** Add a standard MIT license file at the repository root.

```
MIT License

Copyright (c) 2026 TaKeN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. Important Improvements (Prioritized)

### HIGH Priority

#### HIGH-1: Biome schema version mismatch

- **File:** `biome.json:2`
- **Problem:** Schema `2.4.4` vs CLI `2.4.3`. Produces info-level diagnostic in CI output.
- **Fix:** Change to `"$schema": "https://biomejs.dev/schemas/2.4.3/schema.json"` or upgrade `@biomejs/biome` to `2.4.4`.

#### HIGH-2: `miio-transport.ts` coverage exclusion

- **File:** `vitest.config.ts:10`
- **Problem:** The most critical and complex module is excluded from coverage. This is understandable (UDP/crypto integration), but means regressions in protocol handling, encryption, response parsing, or session management won't be caught.
- **Recommendation:** Consider adding targeted unit tests for the pure functions and isolated logic within `miio-transport.ts`:
  - `toBoolean`, `toNumber`, `toMode` — trivially testable
  - `encrypt`/`decrypt` round-trip with known vectors
  - `trySetViaMiot` parameter mapping (can be tested with a mock `call`)
  - `readViaMiot`/`readViaLegacy` with stubbed `call`
  - Handshake packet construction (pure Buffer logic)

  This would bring coverage for the safe-to-test portions while keeping the actual UDP I/O excluded.

#### HIGH-3: `config.schema.json` declares `pluginType: "accessory"` but listing is not a Homebridge verified plugin

- **File:** `config.schema.json:3`
- **Problem:** Not an issue per se, but worth noting that the `pluginType` is `"accessory"` (not `"platform"`). This is correct for the current single-device-per-accessory architecture. If multi-device support is ever desired, migration to a platform plugin will be needed.
- **Action:** Document this architectural decision. No code change needed now.

### MEDIUM Priority

#### MED-1: `Reflect.get` usage for accessing characteristic constants

- **File:** `src/accessories/air-purifier.ts:94,207-213,229-236,273-274`
- **Problem:** The code uses `Reflect.get(this.api.hap.Characteristic as object, "ConfiguredName")` and similar patterns to defensively access optional HAP constants. While safe, this makes the code harder to read and type-check.
- **Recommendation:** Consider using standard optional chaining with `in` operator:
  ```ts
  const configuredName = "ConfiguredName" in this.api.hap.Characteristic
    ? this.api.hap.Characteristic.ConfiguredName
    : undefined;
  ```
  This is equivalent but more idiomatic TypeScript.

#### MED-2: `setInterval` timers should use `unref()` for graceful shutdown

- **File:** `src/core/device-client.ts:127-137`
- **Problem:** Three `setInterval` timers are created for polling. If Homebridge's shutdown handler does not call `shutdown()` (e.g., SIGKILL), these timers will keep the Node.js process alive.
- **Fix:** Call `.unref()` on each timer:
  ```ts
  this.operationTimer = setInterval(...);
  this.operationTimer.unref();
  ```

#### MED-3: `nextMessageId` can overflow

- **File:** `src/core/miio-transport.ts:548`
- **Problem:** `this.nextMessageId++` will eventually exceed `Number.MAX_SAFE_INTEGER` if the plugin runs for years with frequent polling. Unlikely in practice but technically a correctness issue.
- **Fix:** Wrap around: `this.nextMessageId = (this.nextMessageId % 0x7FFFFFFF) + 1;`

#### MED-4: No `onGet` handlers for HomeKit characteristics

- **File:** `src/accessories/air-purifier.ts:117-145`
- **Problem:** The plugin only registers `onSet` handlers and pushes updates via `updateCharacteristic`. There are no `onGet` handlers. When HomeKit queries a characteristic (e.g., opening the Home app), it will get the cached value from HAP, which may be stale if the polling cycle hasn't run yet.
- **Recommendation:** Register `onGet` handlers that return the latest cached value from `this.client.state`. This ensures HomeKit reads are always answered from the most recent known state:
  ```ts
  this.powerService
    .getCharacteristic(this.api.hap.Characteristic.On)
    .onGet(() => this.client.state?.power ?? false)
    .onSet(async (value) => this.client.setPower(Boolean(value)));
  ```

#### MED-5: Hardcoded polling intervals

- **File:** `src/core/device-client.ts:59-61`
- **Problem:** Operation poll (10s) and sensor poll (30s) intervals are hardcoded defaults in `DeviceClient` but not configurable from `config.schema.json`. Users with slow networks or battery-powered setups might want to adjust these.
- **Recommendation:** Consider exposing `operationPollIntervalMs` and `sensorPollIntervalMs` in the config schema for advanced users.

### LOW Priority

#### LOW-1: `.gitkeep` file serves no purpose

- **File:** `.gitkeep` (root)
- **Problem:** This file was likely created during initial repository setup but is no longer needed since there are actual files in the root.
- **Fix:** Remove it.

#### LOW-2: `RELEASE_CHECKLIST.md` mentions `npm run release` but script doesn't exist

- **File:** `RELEASE_CHECKLIST.md:7`
- **Problem:** The checklist says "Run `npm run release`" but `package.json` only has `release:patch`, `release:minor`, `release:major`.
- **Fix:** Update checklist to specify the correct script name.

#### LOW-3: `npm pack --dry-run` shows LICENSE is not included

- **Problem:** Since LICENSE doesn't exist, `npm pack` won't include it. The `files` array in `package.json` lists `"LICENSE"` which won't match anything.
- **Fix:** Fixed by CRIT-1 (creating the LICENSE file).

#### LOW-4: Consider `npm-run-all` or a single `check` script

- **Problem:** Developers must run `lint`, `typecheck`, `test`, and `build` separately.
- **Suggestion:** Add a convenience script:
  ```json
  "check": "npm run lint && npm run typecheck && npm test && npm run build"
  ```

#### LOW-5: No `.npmrc` to enforce engine strictness

- **Problem:** Without `engine-strict=true`, users on unsupported Node versions won't get an error on install.
- **Fix:** Add `.npmrc` with `engine-strict=true`.

---

## 4. Detailed Analysis

### 4.1 Homebridge 1.x / 2.x Compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| Accessory registration | PASS | `api.registerAccessory()` in `index.ts` — correct pattern |
| `getServices()` returns services | PASS | Returns array of HAP services properly |
| Shutdown handler | PASS | `api.on("shutdown", ...)` registered, clears timers, closes socket |
| Config validation at startup | PASS | Throws on invalid token/name/address before creating services |
| `config.schema.json` | PASS | Well-structured with layout hints for Config UI X |
| `pluginAlias` matches code | PASS | `"XiaomiMiAirPurifier"` matches `ACCESSORY_NAME` |
| `pluginType` | PASS | `"accessory"` — correct for single-device plugins |
| `peerDependencies` | PASS | `"homebridge": "^1.11.1 \|\| ^2.0.0-beta.0"` |
| `engines.homebridge` | PASS | Matches peerDependencies |
| `engines.node` | PASS | `"^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0"` |
| Logging levels | PASS | `debug` for internal state, `info` for connections, `warn` for errors |
| No sensitive data in logs | PASS | Token is never logged |
| `_bridge` child bridge support | PASS | Documented in README config example |
| HAP Service naming | PASS | Subtype strings used to prevent UUID collisions |
| `ConfiguredName` support | PASS | Defensive check with fallback |
| Characteristic caching (dedup) | PASS | `characteristicCache` prevents redundant `updateCharacteristic` calls |

**Compliance Score: 16/16 — Excellent**

### 4.2 Code Quality Assessment

#### Architecture (Excellent)

The codebase follows clean architecture principles:

- **`src/index.ts`** — Entry point, 6 lines. Minimal.
- **`src/platform.ts`** — Config validation and wiring. No business logic.
- **`src/accessories/air-purifier.ts`** — HomeKit service creation and characteristic mapping. Delegates all device I/O to `DeviceClient`.
- **`src/core/device-client.ts`** — Operation queue, polling, retry, connection lifecycle. Transport-agnostic.
- **`src/core/miio-transport.ts`** — Raw MIIO/MIOT protocol over UDP. AES-128-CBC encryption.
- **`src/core/mappers.ts`** — Pure functions for value conversion.
- **`src/core/mode-policy.ts`** — Pure functions for mode switch logic.
- **`src/core/retry.ts`** — Retry policy and backoff computation.
- **`src/core/types.ts`** — Shared type definitions and interfaces.

No god objects. Clear SRP boundaries. Each module is independently testable.

#### Async/Await Patterns (Very Good)

- `DeviceClient.enqueueOperation()` implements a serialized promise queue that prevents race conditions.
- All async errors are caught and logged — no unhandled promise rejections.
- `void this.client.init().then(...).catch(...)` pattern in the constructor correctly avoids floating promises.
- `delay()` method respects `destroyed` flag to avoid unnecessary waits during shutdown.

#### Error Handling (Very Good)

- Transport errors are classified as retryable vs non-retryable using error codes.
- `RETRYABLE_ERROR_CODES` is comprehensive (17 codes covering timeout, reset, DNS, unreachable).
- Connection listeners and state listeners are wrapped in try/catch to prevent one bad listener from breaking the system.
- `MiioCommandError` distinguishes protocol-level errors from transport errors.

#### Resource Management (Very Good)

- All timers (`setInterval`, `setTimeout`) are tracked and cleared in `clearTimers()`.
- `retryDelayResolve` is resolved on shutdown to prevent hanging promises.
- UDP socket is closed with proper `ERR_SOCKET_DGRAM_NOT_RUNNING` handling.
- `destroyed` flag prevents new operations after shutdown.

#### TypeScript Strictness (Excellent)

`tsconfig.json` enables:
- `strict: true`
- `noImplicitAny`
- `noUnusedLocals` / `noUnusedParameters`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`

Biome enforces `noExplicitAny: "error"`. This is the strictest practical TS configuration.

### 4.3 Security Audit

| Check | Status | Details |
|-------|--------|--------|
| Token not logged | PASS | Grep confirms token never appears in log statements |
| Token not stored beyond config | PASS | Only in `config.json` (Homebridge standard) |
| AES-128-CBC encryption | PASS | Uses `node:crypto` — standard MIIO protocol |
| No external network calls | PASS | UDP only to device IP on LAN port 54321 |
| No eval/Function constructor | PASS | No dynamic code execution |
| No child_process usage | PASS | Only `node:crypto` and `node:dgram` |
| Dependencies minimal | PASS | **Zero production dependencies** |
| `npm audit` clean | PASS | 0 vulnerabilities |
| Lock file present | PASS | `package-lock.json` committed |
| Provenance on publish | PASS | `npm publish --provenance` in release workflow |
| `id-token: write` permission | PASS | Correctly scoped for npm provenance |
| `contents: write` permission | NOTE | Needed for GitHub release creation, but be aware this grants write access to repository contents |

**Security Score: Excellent** — Zero production dependencies is the gold standard for a Homebridge plugin.

### 4.4 Tests and CI/CD Assessment

#### Test Quality (Excellent)

| Metric | Value |
|--------|-------|
| Test files | 8 |
| Total tests | 60 |
| Coverage (lines/branches/functions/statements) | 100% (miio-transport.ts excluded) |
| Threshold enforcement | Yes, in `vitest.config.ts` |
| Fake timers | Yes, for polling/retry tests |
| Fake transport | Yes, for device client tests |
| Network scenario tests | 7 (purifier restart, router restart, packet loss, HB restart, hot-reload, short/long WiFi outage) |

The test suite is remarkably thorough for a Homebridge plugin. Key highlights:
- Tests cover error branches, non-Error rejections, listener failures, queue recovery.
- Fake timers ensure deterministic testing of polling and backoff.
- The `ScriptedTransport` pattern for simulating ordered failure/success sequences is well-designed.

#### CI/CD Quality (Very Good)

| Pipeline Step | Status | Notes |
|---------------|--------|-------|
| Lint (Biome) | PASS | Node 20/22/24 matrix |
| Typecheck (tsc) | PASS | Node 20/22/24 matrix |
| Test + coverage | PASS | Node 20/22/24 matrix, artifacts uploaded |
| Build (tsc) | PASS | Node 20/22/24 matrix |
| npm audit | PASS | `--audit-level=high` |
| npm pack --dry-run | PASS | In build job |
| Release workflow | PASS | Tag-triggered, npm provenance, GitHub release |
| Dependabot | PASS | npm weekly + GitHub Actions weekly |

**CI Suggestion:** Consider adding a job that validates the `npm pack` output contains expected files (e.g., check that `dist/index.js` and `config.schema.json` are present).

### 4.5 Dependabot Configuration (Good)

```yaml
# Current
- package-ecosystem: npm        # weekly, limit 10
- package-ecosystem: github-actions  # weekly, limit 5
```

**Suggestions:**
- Add `groups` to batch minor/patch updates for dev dependencies:
  ```yaml
  groups:
    dev-dependencies:
      patterns: ["*"]
      update-types: ["minor", "patch"]
  ```
- Consider adding `versioning-strategy: increase` for predictable lockfile updates.

---

## 5. Homebridge Compatibility Score

| Category | Score | Max |
|----------|-------|-----|
| Registration & lifecycle | 5 | 5 |
| Config validation & schema | 5 | 5 |
| Service/Characteristic mapping | 4 | 5 |
| Connection resilience | 5 | 5 |
| Logging practices | 5 | 5 |
| Node/Homebridge version compat | 5 | 5 |
| **Total** | **29** | **30** |

**-1 point** for missing `onGet` handlers (MED-4). Everything else is exemplary.

---

## 6. "Ready for npm?" Checklist

| Item | Status | Notes |
|------|--------|-------|
| `LICENSE` file | **MISSING** | CRIT-1 — Must add before publish |
| `README.md` | PRESENT | Excellent — config, examples, troubleshooting |
| `CHANGELOG.md` | PRESENT | Keep a Changelog format |
| `CONTRIBUTING.md` | PRESENT | Brief but sufficient |
| `CODE_OF_CONDUCT.md` | PRESENT | Contributor Covenant 2.1 |
| `SECURITY.md` | PRESENT | Private reporting process documented |
| Issue templates | PRESENT | Bug report + feature request + config.yml |
| `config.schema.json` | PRESENT | Well-structured with layout |
| `package.json` — name | PRESENT | `homebridge-xiaomi-air-purifier-modern` |
| `package.json` — keywords | PRESENT | `homebridge-plugin`, `homebridge`, etc. |
| `package.json` — homepage | PRESENT | GitHub URL |
| `package.json` — repository | PRESENT | Git URL |
| `package.json` — bugs | PRESENT | GitHub issues URL |
| `package.json` — license | PRESENT | `"MIT"` |
| `package.json` — engines | PRESENT | Node + Homebridge ranges |
| `package.json` — peerDependencies | PRESENT | Homebridge |
| `package.json` — files | PRESENT | `dist`, `config.schema.json`, etc. |
| `package.json` — main | PRESENT | `dist/index.js` |
| `package.json` — types | PRESENT | `dist/index.d.ts` |
| `tsconfig.json` | PRESENT | Strict configuration |
| Linter config | PRESENT | Biome with recommended rules |
| Formatter config | PRESENT | Biome (spaces, 2-width, 100 cols) |
| `.editorconfig` | PRESENT | Comprehensive |
| `.gitignore` | PRESENT | `node_modules`, `dist`, `coverage`, `*.tgz` |
| `package-lock.json` | PRESENT | Committed |
| Build output (`dist/`) | PRESENT | TypeScript compiles cleanly |
| `npm pack` sanity | PASS | 23 files, 17.9 kB |
| `npm audit` | PASS | 0 vulnerabilities |
| CI pipeline | PASS | Lint, typecheck, test, build, audit |
| Release workflow | PRESENT | Tag-triggered npm publish with provenance |
| Dependabot | PRESENT | npm + GitHub Actions |
| `.npmrc` engine-strict | **MISSING** | LOW-5 — Optional but recommended |

**Verdict: 1 blocker (LICENSE file), otherwise ready for npm.**

---

## 7. Summary of Recommended Actions

### Before First Publish (Priority: Immediate)

1. **Add `LICENSE` file** (CRIT-1)
2. **Fix Biome schema version** (HIGH-1)
3. **Fix `RELEASE_CHECKLIST.md`** typo (LOW-2)
4. **Remove `.gitkeep`** (LOW-1)

### Soon After Publish (Priority: High)

5. **Add `onGet` handlers** for all readable characteristics (MED-4)
6. **Add `unref()` to polling timers** (MED-2)
7. **Add unit tests for miio-transport pure functions** (HIGH-2)
8. **Add `.npmrc` with `engine-strict=true`** (LOW-5)

### Future Enhancements (Priority: Medium/Low)

9. **Wrap `nextMessageId`** to prevent overflow (MED-3)
10. **Expose poll intervals in config** (MED-5)
11. **Add convenience `check` script** (LOW-4)
12. **Improve Dependabot config with groups** (suggestion)

---

## 8. Final Assessment

This is an **exceptionally well-built Homebridge plugin**. The architecture is clean, the TypeScript is strict, the test coverage is industry-leading for the Homebridge ecosystem, the CI pipeline is comprehensive, and the documentation is thorough. The zero-dependency approach eliminates supply chain risk entirely.

The only true publication blocker is the missing LICENSE file. Once that's added, this plugin is ready for npm.

**Overall Quality Rating: 9.2 / 10**

| Dimension | Rating |
|-----------|--------|
| Code quality | 9/10 |
| Architecture | 10/10 |
| Test coverage | 9/10 |
| CI/CD | 9/10 |
| Documentation | 9/10 |
| Security | 10/10 |
| Homebridge compliance | 9.5/10 |
| npm readiness | 8/10 (LICENSE blocker) |
