# Comprehensive Code Review & Quality Audit Report

**Project:** homebridge-xiaomi-air-purifier-modern
**Repository:** takenek/xiaomi-mi-air-purifier-ng
**Date:** 2026-02-27
**Auditor:** Claude Opus 4.6 (automated)
**Scope:** Full codebase — source, tests, CI/CD, config, docs, supply chain, Homebridge 1.x/2.x compliance

---

## Executive Summary

### Biggest strengths

1. **100% test coverage** — Statements, branches, functions, and lines are all at 100% with enforced thresholds in `vitest.config.ts`. Coverage is real, not trivial — 84 tests across 9 suites cover network scenarios, retry logic, protocol fallbacks, and HomeKit mapping.
2. **Zero runtime dependencies** — The plugin uses only Node.js built-ins (`node:crypto`, `node:dgram`) for MIIO protocol transport. No third-party runtime dependency bloat.
3. **Professional CI/CD pipeline** — Matrix CI (Node 20/22/24, Homebridge 1.x/beta-2.x), semantic-release automation, npm provenance publishing, SBOM generation (CycloneDX), OSV scanner, and Dependabot for both npm and GitHub Actions.
4. **Robust reconnect/retry logic** — Exponential backoff with jitter, comprehensive retryable error code set, operation queue serialization, timer cleanup on shutdown. Tested with 7+ network failure scenarios.
5. **Clean TypeScript with strict mode** — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitAny`, Biome linter with `noExplicitAny: "error"`. No `any` in the codebase.
6. **Complete OSS governance** — LICENSE, SECURITY.md (with SLA), CODE_OF_CONDUCT.md, CONTRIBUTING.md, CHANGELOG, issue/PR templates, RELEASE_CHECKLIST.

### Biggest risks

1. **README documentation gap** — Two configurable fields (`operationPollIntervalMs`, `sensorPollIntervalMs`) are present in `config.schema.json` and code but missing from the README configuration table.
2. **README Features table inaccuracy** — Features table says "Switch: Power" but code dynamically uses native `AirPurifier` service when available (Homebridge 2.x), falling back to `Switch` only for Homebridge 1.x.
3. **Filter alert Contact Sensor polarity is inverted in README** — README states "`CONTACT_DETECTED` when replacement is needed" but code maps low filter life to `CONTACT_NOT_DETECTED` (open contact = alert, which is the standard HomeKit convention for "problem detected"). The README text contradicts the code.

---

## 1. Structure & Architecture Analysis

### Directory structure

```
src/
  index.ts               — Homebridge entry point (registerAccessory)
  platform.ts            — Config parsing, validation, DI assembly
  accessories/
    air-purifier.ts      — HomeKit service/characteristic binding
  core/
    types.ts             — Shared types (DeviceState, MiioTransport interface)
    device-client.ts     — Polling, retry, state management, operation queue
    miio-transport.ts    — UDP transport, MIIO protocol, MIOT/legacy dual-mode
    mappers.ts           — Fan level ↔ rotation speed, AQI → AirQuality mapping
    mode-policy.ts       — Mode switch logic (auto/sleep toggling)
    retry.ts             — Backoff computation, retryable error classification
test/
  9 test files           — 84 tests total
```

**Assessment:** Clean separation of concerns. `MiioTransport` interface in `types.ts` decouples transport from client. Each module has a single responsibility. No "god objects". **Rating: Excellent.**

### Module dependency flow

```
index.ts → platform.ts → air-purifier.ts → device-client.ts → miio-transport.ts
                                          → mappers.ts
                                          → mode-policy.ts
                                      device-client.ts → retry.ts
                                      miio-transport.ts → retry.ts
```

No circular dependencies. Clean unidirectional graph.

---

## 2. Homebridge 1.x / 2.x Compliance

### Registration pattern

- Uses `api.registerAccessory()` (accessory plugin pattern) — correct for single-device plugins.
- `PLUGIN_NAME` = `"homebridge-xiaomi-air-purifier-modern"` matches `package.json` name — **correct**.
- `ACCESSORY_NAME` = `"XiaomiMiAirPurifier"` matches `config.schema.json` `pluginAlias` — **correct**.

### Homebridge 2.x (AirPurifier service) support

The code probes for `Service.AirPurifier` via `Reflect.get()` at runtime:
- **If present (HB 2.x):** Uses native AirPurifier service with `Active`, `CurrentAirPurifierState`, `TargetAirPurifierState`, and `RotationSpeed` characteristics.
- **If absent (HB 1.x):** Falls back to `Switch("Power")`.

This is a thoughtful compatibility approach tested in the test suite with and without the AirPurifier service mock.

### Shutdown handling

```typescript
this.api.on("shutdown", () => {
  void this.client.shutdown().catch(/* logged */);
});
```

`client.shutdown()` sets `destroyed = true`, clears all timers, closes the UDP socket. **Correct.**

### State refresh

- Uses polling (operation/sensor/keepalive intervals) with `updateCharacteristic()` push model.
- `updateCharacteristicIfNeeded()` uses a local cache to avoid redundant updates — **best practice**.
- `onGet` handlers return cached values — **correct for responsive UI**.

### Config validation

- Token: 32-char hex regex validated.
- Model: Validated against known set.
- All timeouts: Validated, clamped, with sensible defaults.
- All booleans: Type-checked with fallbacks.

### Peer dependencies

```json
"peerDependencies": { "homebridge": "^1.11.1 || ^2.0.0" }
```

Matches `engines.homebridge` — **correct**.

### Score: 9/10

Minor deduction: The `ConfiguredName` characteristic is set via `Reflect.get()` duck-typing which is fragile but pragmatic for cross-version compatibility.

---

## 3. Code Quality (Node.js/TypeScript)

### Async patterns

- **Operation queue:** `enqueueOperation()` serializes all device operations to prevent concurrent UDP sends. Previous queue errors are caught and logged (not suppressed silently). **Excellent.**
- **`void` keyword:** Correctly used for fire-and-forget promises (`void this.client.init().then(...)`, `void this.client.shutdown().catch(...)`).
- No unhandled promise rejections — all `.catch()` paths log errors.

### Error handling

- All `catch` blocks distinguish `Error` from non-Error values.
- `isRetryableError()` checks error code against a comprehensive set (16 codes).
- `computeBackoffDelay()` implements exponential backoff with jitter.
- `MiioCommandError` subclass distinguishes protocol errors from transport errors.

### Resource management

- All `setInterval`/`setTimeout` timers call `.unref()` — prevents the plugin from keeping the Node.js process alive.
- `clearTimers()` cleans up all timers on shutdown.
- `retryDelayResolve` pattern: pending retry delay is resolved immediately on shutdown — no dangling promises.
- UDP socket: Properly closed with `ERR_SOCKET_DGRAM_NOT_RUNNING` edge case handled.

### Type safety

- `tsconfig.json` has maximum strictness: `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Biome enforces `noExplicitAny: "error"`.
- `ReadProperty` is a const-derived union type — no string typos possible.

### Potential improvements (non-blocking)

| Item | Severity | Description |
|------|----------|-------------|
| `Reflect.get` usage | Low | Used in 6+ places for cross-version characteristic access. A small helper like `getOptionalCharacteristic()` would improve readability. |
| `c8 ignore` pragmas | Low | ~10 `/* c8 ignore */` comments in `miio-transport.ts`. While understood (defensive fallback branches in live UDP protocol code), they slightly weaken the "real" coverage story. |
| `as never` casts | Low | Test code uses `as never` in ~20 places for fake API objects. Acceptable in tests but could be cleaner with a shared test utility module. |

### Score: 9.5/10

---

## 4. Security & Supply Chain

### Sensitive data handling

- **Token:** Validated in constructor, never logged. Used only for AES key derivation.
- **IP address:** `maskDeviceAddressInLogs` option masks to `x.x.*.*` pattern. Serial number uses IP but only in HomeKit (local, not logged).
- **No credentials stored on disk.** Config is read from Homebridge's own config store.

### Communication security

- MIIO protocol uses AES-128-CBC encryption with MD5-derived key/IV from device token.
- UDP 54321 — no TLS (inherent MIIO protocol limitation). README documents this and recommends VLAN isolation.
- Token is transmitted encrypted in every packet (protocol requirement).

### Dependency security

| Check | Result |
|-------|--------|
| `npm audit` | **0 vulnerabilities** |
| Runtime dependencies | **Zero** (only Node.js built-ins) |
| Dev dependencies | 5 packages (biome, @types/node, @vitest/coverage-v8, typescript, vitest) + homebridge as dev |
| Deprecated packages | Only `q@1.1.2` (transitive via homebridge@1.x — expected, per specification) |
| Lock file | `package-lock.json` present and committed |
| `.npmrc` | `engine-strict=true` — enforces Node version |

### Supply chain hardening

- **OSV scanner** in CI (`supply-chain.yml`) — scans `package-lock.json` weekly.
- **SBOM generation** — CycloneDX format artifact produced in CI.
- **npm provenance** — enabled in release workflow (`NPM_CONFIG_PROVENANCE: "true"`).
- **Dependabot** — configured for both npm and github-actions ecosystems (weekly).
- **CI audit job** — `npm audit --audit-level=high` runs on every push/PR.

### Score: 10/10

---

## 5. Tests, CI/CD & Automation

### Test suite

| File | Tests | Coverage area |
|------|-------|--------------|
| `device-api.test.ts` | 2 | Read/write API contract |
| `mode-policy.test.ts` | 4 | Mode switch logic |
| `mappers.test.ts` | 4 | Fan level + AQI mapping |
| `accessory-platform-index.test.ts` | 15 | Service binding, config validation, shutdown, filter alerts, HB2 |
| `miio-transport-coverage.test.ts` | 20 | MIIO protocol internals, encryption, handshake, error paths |
| `reliability.test.ts` | 5 | Retry with backoff, polling recovery, simulated network scenarios |
| `device-client-branches.test.ts` | 19 | Queue serialization, listener error handling, all set commands |
| `network-scenarios.test.ts` | 7 | Purifier restart, router restart, packet loss, Wi-Fi outage |
| `miio-transport-reliability.test.ts` | 8 | Retryable error propagation, socket shutdown, MIOT batch reads |
| **Total** | **84** | **100%/100%/100%/100%** |

### Coverage enforcement

```typescript
// vitest.config.ts
thresholds: {
  lines: 100,
  branches: 100,
  functions: 100,
  statements: 100,
}
```

**Any new code that drops coverage below 100% will fail CI.** This is enforced.

### CI matrix

| Node | Homebridge | Lane |
|------|-----------|------|
| 20 | 1.11.2 | full |
| 22 | 1.11.2 | full |
| 24 | 1.11.2 | full |
| 22 | beta (2.x) | full |
| 24 | beta (2.x) | smoke |

### Release workflow

- **semantic-release** with conventional commits.
- Plugins: commit-analyzer, release-notes-generator, changelog, npm (with provenance), git (commits changelog/package.json back), github (creates release).
- Triggered on push to `main`.
- `prepublishOnly` runs lint + typecheck + test + build — catches broken publishes.

### Score: 10/10

---

## 6. Documentation & README Accuracy

### README vs Code discrepancies

| # | Issue | Severity | Details |
|---|-------|----------|---------|
| D1 | Missing config fields in README table | Medium | `operationPollIntervalMs` and `sensorPollIntervalMs` are in `config.schema.json` (lines 107-118) and `XiaomiAccessoryConfig` type (platform.ts:37-38) but **not listed** in the README Configuration fields table. |
| D2 | Features table says "Switch: Power" | Low | Code uses native `AirPurifier` service on HB2, only `Switch` on HB1. The table should note this or list both. |
| D3 | Filter alert Contact Sensor polarity inverted | Medium | README line 158: "`CONTACT_DETECTED` when replacement is needed" — **incorrect**. Code (air-purifier.ts:490-492) maps low filter life → `CONTACT_NOT_DETECTED` (open = problem). Should read "`CONTACT_NOT_DETECTED` when replacement is needed". |
| D4 | PM2.5Density mapping not documented | Low | `PM2_5Density` characteristic is set to `Math.max(0, state.aqi)` (air-purifier.ts:411) but not mentioned in the README HomeKit mapping section. |

### Documentation completeness checklist

| Item | Present | Notes |
|------|---------|-------|
| LICENSE | Yes | MIT, Copyright 2026 TaKeN |
| README | Yes | Comprehensive with config, troubleshooting, network hardening |
| CHANGELOG | Yes | Keep a Changelog format, SemVer |
| CONTRIBUTING | Yes | Conventional commits, local checks, PR process |
| CODE_OF_CONDUCT | Yes | Contributor Covenant 2.1 |
| SECURITY.md | Yes | With severity SLA table |
| Issue templates | Yes | Bug report + feature request (YAML format) |
| PR template | Yes | With checklist |
| config.schema.json | Yes | Full Homebridge UI schema with layout |
| docs/reliability-testing.md | Yes | Referenced in README |

### Score: 7.5/10 (due to D1 and D3 inaccuracies)

---

## 7. Package.json & npm Readiness

### Metadata completeness

| Field | Value | Status |
|-------|-------|--------|
| `name` | `homebridge-xiaomi-air-purifier-modern` | OK |
| `version` | `1.0.0` | OK |
| `description` | Present | OK |
| `main` | `dist/index.js` | OK |
| `types` | `dist/index.d.ts` | OK |
| `keywords` | 15 keywords including `homebridge-plugin` | OK |
| `engines.node` | `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` | OK |
| `engines.homebridge` | `^1.11.1 \|\| ^2.0.0` | OK |
| `homepage` | GitHub URL | OK |
| `repository` | GitHub URL (git+https) | OK |
| `bugs` | GitHub issues URL | OK |
| `license` | `MIT` | OK |
| `author` | name + url | OK |
| `displayName` | `Xiaomi Mi Air Purifier Modern` | OK |
| `type` | `commonjs` | OK (matches tsconfig `module: CommonJS`) |
| `files` | `["dist", "config.schema.json", "README.md", "CHANGELOG.md", "LICENSE", "SECURITY.md", "CODE_OF_CONDUCT.md"]` | OK |
| `peerDependencies` | `homebridge: ^1.11.1 \|\| ^2.0.0` | OK |

### Scripts

| Script | Command | Status |
|--------|---------|--------|
| `build` | `tsc -p tsconfig.json` | OK |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | OK |
| `lint` | `biome check .` | OK |
| `lint:fix` | `biome check --write .` | OK |
| `test` | `vitest run --coverage` | OK |
| `test:watch` | `vitest` | OK |
| `prepublishOnly` | lint + typecheck + test + build | OK |
| `check` | lint + typecheck + test | OK |
| `prepare` | build | OK |

### npm pack dry-run

25 files, 20.7 kB packed. Only `dist/`, `config.schema.json`, and documentation files. **No source code, tests, or config files leak into the package.** Excellent.

---

## 8. "What's Missing" Checklist

| Item | Present | Notes |
|------|---------|-------|
| LICENSE | ✅ | MIT |
| README with config + examples | ✅ | Full config example with JSON |
| README troubleshooting | ✅ | 3 common issues documented |
| CHANGELOG | ✅ | Keep a Changelog format |
| CONTRIBUTING | ✅ | |
| CODE_OF_CONDUCT | ✅ | |
| SECURITY.md | ✅ | With severity SLA |
| Issue templates | ✅ | Bug + Feature (YAML) |
| PR template | ✅ | With CI checklist |
| tsconfig.json | ✅ | Strict mode |
| Linter config (biome.json) | ✅ | Recommended rules + noExplicitAny |
| Formatter config | ✅ | Biome formatter (indentStyle: space) |
| .editorconfig | ✅ | UTF-8, LF, 2-space indent |
| .gitignore | ✅ | node_modules, dist, coverage, *.tgz |
| .npmrc | ✅ | engine-strict=true |
| package-lock.json | ✅ | Committed |
| files / .npmignore | ✅ | `files` field used (allowlist) |
| keywords (npm) | ✅ | 15 relevant keywords |
| homepage / repository / bugs | ✅ | All present |
| peerDependencies | ✅ | homebridge |
| engines (node + homebridge) | ✅ | |
| config.schema.json | ✅ | Full schema with layout |
| Semantic versioning | ✅ | semantic-release configured |
| CI pipeline | ✅ | Build + lint + typecheck + test + audit |
| Release pipeline | ✅ | semantic-release + npm provenance |
| Dependabot (npm + actions) | ✅ | Weekly, with labels |
| Supply chain scan | ✅ | OSV scanner + SBOM |

**Nothing missing from standard npm/Homebridge checklist.**

---

## 9. Critical Issues (Publication Blockers)

### NONE

There are no blockers preventing npm publication. The codebase is production-ready.

---

## 10. Important Improvements (prioritized)

### High priority

| # | Issue | File(s) | Recommendation |
|---|-------|---------|----------------|
| H1 | README missing `operationPollIntervalMs` and `sensorPollIntervalMs` in config table | `README.md` | Add both fields to the Configuration fields table with their defaults (10000ms and 30000ms) and minimum (1000ms). |
| H2 | README Filter alert polarity text is inverted | `README.md:158` | Change "`CONTACT_DETECTED` when replacement is needed" to "`CONTACT_NOT_DETECTED` when replacement is needed, otherwise `CONTACT_DETECTED`". |

### Medium priority

| # | Issue | File(s) | Recommendation |
|---|-------|---------|----------------|
| M1 | README Features table doesn't mention HB2 AirPurifier service | `README.md:17` | Update the Features table to note that on HB 2.x, a native AirPurifier service with RotationSpeed is used instead of a Switch. |
| M2 | PM2.5Density characteristic not documented | `README.md` | Add a note that PM2.5Density is exposed on the Air Quality Sensor service. |
| M3 | `@types/node` pinned to major 20 in devDeps | `package.json` | The `@types/node` is `^20.0.0` but engine supports Node 22/24. While harmless (typings are mostly stable), consider `^20.0.0 || ^22.0.0` or just the lowest supported. Current approach is fine — Node type additions are backward compatible. |

### Low priority

| # | Issue | File(s) | Recommendation |
|---|-------|---------|----------------|
| L1 | `c8 ignore` comments in miio-transport.ts | `src/core/miio-transport.ts` | These are for UDP protocol edge cases that can't be reliably triggered in tests. Acceptable, but consider adding a comment explaining *why* each is ignored. |
| L2 | Duplicate test name | `test/accessory-platform-index.test.ts:670,743` | Two tests share the name "uses numeric fallbacks for FilterChangeIndication enum values". Rename one for clarity. |
| L3 | `TRIAGE_DECISIONS.md` is deprecated | Root | Contains only "This document was replaced..." — consider removing it. |
| L4 | Multiple previous audit docs in `docs/` | `docs/` | 8 previous audit documents exist. Consider consolidating or archiving. |

---

## 11. Homebridge 1.x / 2.x Compatibility Score

| Aspect | Score | Notes |
|--------|-------|-------|
| Accessory registration | 10/10 | Correct `registerAccessory` usage |
| Service/Characteristic mapping | 9/10 | Excellent with AirPurifier/Switch fallback, minor Reflect.get fragility |
| Config validation | 10/10 | Complete with sensible defaults |
| Config schema (UI) | 10/10 | Full schema with layout sections |
| Shutdown handling | 10/10 | Timers cleared, socket closed, errors logged |
| State management | 10/10 | Cache + push model, no redundant updates |
| Logging | 10/10 | Appropriate levels, no sensitive data, optional masking |
| Reconnect resilience | 10/10 | Exponential backoff, jitter, comprehensive error codes |
| CI matrix coverage | 10/10 | Node 20/22/24 × HB 1.x/beta-2.x |
| **Overall** | **9.9/10** | |

---

## 12. npm Readiness Checklist — Final Verdict

| # | Requirement | Status |
|---|-------------|--------|
| 1 | `npm ci` succeeds | ✅ |
| 2 | `npm run lint` passes | ✅ |
| 3 | `npm run typecheck` passes | ✅ |
| 4 | `npm test` passes with 100% coverage | ✅ |
| 5 | `npm run build` succeeds | ✅ |
| 6 | `npm pack --dry-run` shows correct files | ✅ |
| 7 | `npm audit` — 0 vulnerabilities | ✅ |
| 8 | No deprecated deps (except q@1.1.2 via homebridge) | ✅ |
| 9 | `package.json` metadata complete | ✅ |
| 10 | `config.schema.json` validates against code | ✅ |
| 11 | Semantic-release configured | ✅ |
| 12 | CI matrix covers all supported runtimes | ✅ |
| 13 | LICENSE present and correct | ✅ |
| 14 | SECURITY.md present | ✅ |
| 15 | README accurate (with noted exceptions) | ⚠️ See H1, H2 |

### Verdict: **READY FOR NPM PUBLICATION**

The two README documentation issues (H1, H2) are non-blocking for publication but should be fixed in the first release or immediately after.

---

## Appendix: Test execution output

```
 ✓ test/mode-policy.test.ts (4 tests) 4ms
 ✓ test/device-api.test.ts (2 tests) 5ms
 ✓ test/mappers.test.ts (4 tests) 4ms
 ✓ test/network-scenarios.test.ts (7 tests) 22ms
 ✓ test/miio-transport-reliability.test.ts (8 tests) 21ms
 ✓ test/miio-transport-coverage.test.ts (20 tests) 35ms
 ✓ test/reliability.test.ts (5 tests) 29ms
 ✓ test/accessory-platform-index.test.ts (15 tests) 40ms
 ✓ test/device-client-branches.test.ts (19 tests) 3225ms

 Test Files  9 passed (9)
      Tests  84 passed (84)

Coverage: 100% statements | 100% branches | 100% functions | 100% lines
```

## Appendix: Dependency tree summary

- **Runtime dependencies:** 0
- **Dev dependencies:** 6 (biome, @types/node, @vitest/coverage-v8, typescript, vitest, homebridge)
- **Total installed (incl. transitive):** 114 packages
- **Vulnerabilities:** 0
- **Deprecated:** q@1.1.2 only (homebridge 1.x transitive — expected)
