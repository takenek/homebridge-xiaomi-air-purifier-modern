# Comprehensive Code Review & Quality Audit Report

**Project:** homebridge-xiaomi-air-purifier-modern
**Date:** 2026-02-27
**Auditor:** Claude (Opus 4.6)
**Scope:** Full code review, security audit, Homebridge compliance, npm readiness

---

## Executive Summary

### Biggest Plusses

1. **Zero runtime dependencies** — The plugin uses only Node.js built-ins (`node:crypto`, `node:dgram`) for MIIO protocol transport. This is exceptional for supply-chain security and reduces attack surface to near-zero.
2. **100% test coverage enforced** — Vitest configured with `thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }`. All 84 tests pass. Coverage is verified in CI across Node 20/22/24.
3. **Professional CI/CD pipeline** — Three GitHub Actions workflows (CI with matrix testing, semantic-release, supply-chain with SBOM + OSV scanner), Dependabot for npm + GitHub Actions, concurrency controls, and minimal permissions.
4. **Clean architecture** — Well-separated concerns: transport layer (`miio-transport.ts`), device client with retry/backoff (`device-client.ts`), HomeKit accessory mapping (`air-purifier.ts`), and pure-function mappers. No god objects.
5. **Robust error handling** — Exponential backoff with jitter, operation queue serialization, graceful shutdown with timer cleanup, connection lifecycle events, and proper separation of retryable vs non-retryable errors.
6. **Complete OSS documentation** — LICENSE, README, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates, PR template, release checklist — all present and well-written.

### Biggest Risks / Areas for Improvement

1. **README "Features" table says "Switch: Power"** but code actually uses native `AirPurifier` service when available (Homebridge 2.x) — documentation slightly misleading (see section 5).
2. **`operationPollIntervalMs` and `sensorPollIntervalMs` not documented in README config table** — they are in config.schema.json but missing from the README table.
3. **`setBuzzerVolume` method exists in DeviceClient but is not exposed** through any HomeKit service or configuration option — dead code path.
4. **`q@1.1.2` (deprecated)** is a transitive dependency of `homebridge@1.11.2 → hap-nodejs → node-persist` — this is a known exception for Homebridge 1.x peer dependency and acceptable per project policy.

---

## 1. Project Structure Analysis

### Directory Layout

```
├── src/
│   ├── index.ts                    # Plugin entry point (registerAccessory)
│   ├── platform.ts                 # AccessoryPlugin implementation + config validation
│   ├── accessories/
│   │   └── air-purifier.ts         # HomeKit service/characteristic mapping
│   └── core/
│       ├── device-client.ts        # High-level device API with retry/polling/queue
│       ├── mappers.ts              # Pure mapping functions (fan level, AQI)
│       ├── miio-transport.ts       # MIIO/MIOT protocol implementation (UDP)
│       ├── mode-policy.ts          # Mode switch logic (pure functions)
│       ├── retry.ts                # Retry policy + backoff computation
│       └── types.ts                # Shared TypeScript types/interfaces
├── test/ (9 test files, 84 tests)
├── .github/ (3 workflows, dependabot, issue/PR templates)
├── docs/ (audit reports, reliability docs)
└── config files (tsconfig, biome, vitest, releaserc, editorconfig, npmrc)
```

**Assessment:** Excellent separation of concerns. The `core/` directory contains protocol and device logic, `accessories/` has HomeKit mapping, and `platform.ts` serves as the composition root. Each file has a single responsibility.

### Source Code Metrics

| Metric | Value |
|--------|-------|
| Source files | 9 (.ts) |
| Test files | 9 (.test.ts) |
| Total source lines | ~1,000 |
| Total test lines | ~3,700 |
| Test-to-code ratio | ~3.7:1 |
| Runtime dependencies | 0 |
| Dev dependencies | 6 |

---

## 2. Homebridge 1.x and 2.x Compliance

### Plugin Registration

```typescript
// src/index.ts
export = (api: API): void => {
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, XiaomiAirPurifierAccessoryPlugin);
};
```

**Assessment:** Correct accessory registration pattern. Uses `export =` for CommonJS module, which is the standard for Homebridge plugins. `PLUGIN_NAME` matches `package.json` name field. `ACCESSORY_NAME` matches `config.schema.json` `pluginAlias`.

### Homebridge 2.x Compatibility

The code uses `Reflect.get` to probe for Homebridge 2.x features:

- **AirPurifier service** (`air-purifier.ts:77-81`): Uses `Reflect.get(api.hap.Service, "AirPurifier")` to detect native AirPurifier service (Homebridge 2.x / newer HAP). Falls back to `Switch` for older versions.
- **ConfiguredName characteristic** (`air-purifier.ts:182-189`): Probes for `ConfiguredName` and gracefully skips if unavailable.
- **FilterChangeIndication enums** (`air-purifier.ts:458-477`): Uses `Reflect.get` for enum constants with numeric fallbacks.

**Score: 9/10** — Excellent forward and backward compatibility. The `Reflect.get` pattern safely handles API differences between Homebridge 1.x and 2.x without hard-coding version checks.

### Configuration Handling

- All config fields have validation: `assertString`, `assertHexToken`, `normalizeModel`, `normalizeThreshold`, `normalizeTimeout`, `normalizeBoolean`
- Invalid config throws clear error messages at startup (fail-fast)
- Token validated with regex: `^[0-9a-fA-F]{32}$`
- Model validated against supported set
- Timeouts clamped with minimum bounds

**Score: 10/10**

### Shutdown Handling

```typescript
this.api.on("shutdown", () => {
  void this.client.shutdown().catch(...)
});
```

- Listens to Homebridge `shutdown` event
- `shutdown()` sets `destroyed` flag, clears all timers, closes UDP socket
- Socket `close()` handles `ERR_SOCKET_DGRAM_NOT_RUNNING` idempotently

**Score: 10/10**

### State Updates and Polling

- Three separate polling intervals: operation (10s), sensor (30s), keep-alive (60s)
- All timers use `.unref()` — won't prevent Node.js process exit
- `updateCharacteristicIfNeeded` uses cache to avoid unnecessary HomeKit updates
- Write operations follow set-then-poll pattern (`enqueueSetAndSync`)

**Score: 10/10**

### Connection Resilience

- Exponential backoff with jitter: `baseDelayMs=400, maxDelayMs=30000, maxRetries=8`
- 15 retryable error codes defined
- Connection lifecycle events: `connected` → `disconnected` → `reconnected`
- Protocol auto-detection: MIOT → legacy fallback with per-call retry

**Score: 10/10**

### Overall Homebridge Compliance Score: 49/50

---

## 3. Code Quality Analysis

### TypeScript Configuration

```json
{
  "strict": true,
  "noImplicitAny": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

**Assessment:** Maximum strictness enabled. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are advanced flags that many projects skip. Excellent.

### Linting (Biome)

```json
{
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } } },
  "formatter": { "enabled": true, "indentStyle": "space" }
}
```

**Assessment:** `noExplicitAny` as error is excellent. Biome replaces both ESLint and Prettier with a single tool. `biome check .` passes cleanly.

### Asynchronous Code Quality

1. **Operation queue** (`device-client.ts:177-197`): Proper serialization of concurrent operations using promise chaining. Previous promise errors are suppressed to keep the queue alive.
2. **Retry loop** (`device-client.ts:199-258`): Clean while loop with attempt counter, backoff delay, and destroyed-flag check.
3. **No floating promises**: All async calls are either `await`-ed or explicitly voided with error handling.
4. **Timer cleanup**: `clearTimers()` handles all interval/timeout handles + resolves pending retry delay.

**Assessment:** Exemplary async code. No race conditions, no unhandled promise rejections, no timer leaks.

### Resource Management

- UDP socket created once per transport, closed on shutdown
- All `setInterval`/`setTimeout` handles tracked and cleared
- `.unref()` on all timers to prevent Node process hanging
- `destroyed` flag prevents operations after shutdown

**Assessment:** No resource leaks identified.

### Error Handling Patterns

- Consistent pattern: `error instanceof Error ? error.message : String(error)`
- Retryable errors classified by error code
- Transport errors distinguished from MIIO command errors
- Listener exceptions caught individually (don't break other listeners)
- Log levels appropriate: `debug` for suppressed errors, `warn` for user-visible issues, `error` for configuration problems

**Assessment:** Production-quality error handling throughout.

### Architecture Concerns

**Minor issues:**

1. **`setBuzzerVolume`** (`device-client.ts:135-137`): Public method that is never called from any HomeKit service. This is dead code. Either remove it or expose it through a configuration option.

2. **`Reflect.get` / `Reflect.set` usage**: Used extensively for dynamic property access. This is a deliberate choice for HAP-NodeJS compatibility (the API surface isn't fully typed in older versions). While functional, it bypasses TypeScript's type system. The pattern is justified here but should be noted.

3. **`as never` type casts** in `air-purifier.ts`: Several casts like `service.updateCharacteristic(characteristic as never, value)` and `service.setCharacteristic(configuredName as never, name)`. These exist because HomeKit characteristic types are complex generics. Acceptable in this context.

---

## 4. Security & Supply Chain

### Sensitive Data Handling

- **Token**: Validated at startup, never logged. Used only for encryption key derivation. ✅
- **IP Address**: Optional masking via `maskDeviceAddressInLogs` config. When enabled, logs show `10.10.*.*`. ✅
- **No cloud communication**: Plugin operates entirely on LAN via UDP 54321. ✅
- **No persistent storage**: No files written, no databases. State is in-memory only. ✅

### Communication Security

- MIIO protocol uses AES-128-CBC encryption with device-specific token
- No TLS (UDP-based protocol limitation)
- README includes network hardening recommendations (VLAN, ACL, WAN egress blocking)

**Assessment:** As secure as the MIIO protocol allows. Network hardening documentation is a notable plus.

### Dependency Audit

```
$ npm audit
found 0 vulnerabilities

$ npm ls --all (114 packages, all devDependencies)
```

| Dependency | Version | Status |
|------------|---------|--------|
| @biomejs/biome | ^2.4.4 | Current ✅ |
| @types/node | ^20.0.0 | Current ✅ |
| @vitest/coverage-v8 | ^4.0.0 | Current ✅ |
| typescript | ^5.8.2 | Current ✅ |
| vitest | ^4.0.0 | Current ✅ |
| homebridge | ^1.11.1 (dev) | Current ✅ |

**Runtime dependencies: 0** — This is the gold standard for supply-chain security.

**Transitive deprecated package: `q@1.1.2`** — via `homebridge → hap-nodejs → node-persist`. This is a known Homebridge 1.x ecosystem issue. Not actionable by this plugin. Acceptable per project policy.

### Package Lock & Pinning

- `package-lock.json` present and committed ✅
- `.npmrc` with `engine-strict=true` ✅
- Dependabot configured for both npm and GitHub Actions ✅
- Supply-chain workflow with SBOM (CycloneDX) and OSV scanner ✅

**Security Score: 10/10**

---

## 5. Documentation Accuracy (README vs Code)

### Verified Claims ✅

| README Claim | Code Location | Verdict |
|-------------|---------------|---------|
| Models: 2H, 3, 3H, 4, Pro | `platform.ts:16-22` | ✅ Match |
| AQI mapping thresholds | `mappers.ts:18-40` | ✅ Match |
| Filter threshold default 10 | `platform.ts:82-95` | ✅ Match |
| Config fields and defaults | `platform.ts:97-183` | ✅ Match |
| Polling intervals 10s/30s/60s | `device-client.ts:67-69` | ✅ Match |
| Token regex 32-char hex | `platform.ts:62-69` | ✅ Match |
| Exponential backoff with jitter | `retry.ts:15-25` | ✅ Match |
| Timer cleanup on shutdown | `device-client.ts:109-113, 278-301` | ✅ Match |
| `pluginAlias` = `XiaomiMiAirPurifier` | `config.schema.json:2` | ✅ Match |

### Issues Found

1. **README Features table says "Switch: Power"** — but the code actually uses the native `AirPurifier` service when available (Homebridge 2.x HAP with AirPurifier service class). On Homebridge 1.x or older HAP versions without AirPurifier, it falls back to a Switch. The README should clarify this dual behavior.

   **Severity: Low** — Functionally correct for both versions, but the table is slightly misleading.

2. **`operationPollIntervalMs` and `sensorPollIntervalMs`** are defined in `config.schema.json` and accepted in code, but **missing from the README Configuration fields table**. The README table lists `connectTimeoutMs`, `operationTimeoutMs`, `reconnectDelayMs`, `keepAliveIntervalMs`, `maskDeviceAddressInLogs` but omits these two polling intervals.

   **Severity: Medium** — Users looking at README won't know these options exist.

3. **Filter Replace Alert ContactSensor state direction**: README says `CONTACT_DETECTED when replacement is needed`, but code at `air-purifier.ts:489-499` actually sets `CONTACT_NOT_DETECTED` when `filter1_life <= threshold` (i.e., when replacement is needed). The HomeKit semantics are: `CONTACT_NOT_DETECTED = 1` (alert state), `CONTACT_DETECTED = 0` (normal). So the code is correct but the README description is inverted.

   **Severity: Medium** — Could confuse users who read the documentation.

---

## 6. Test Quality Assessment

### Coverage

```
All files          | 100% Stmts | 100% Branch | 100% Funcs | 100% Lines
```

84 tests across 9 test files. All pass. ✅

### Test Categories

| Category | Files | Tests | Quality |
|----------|-------|-------|---------|
| Unit (pure functions) | mappers, mode-policy | 8 | Good |
| Component (client, transport) | device-api, device-client-branches, miio-transport-coverage, miio-transport-reliability | 49 | Excellent |
| Integration (scenarios) | network-scenarios, reliability | 12 | Excellent |
| End-to-end (HomeKit) | accessory-platform-index | 15 | Excellent |

### Strengths

- Test-to-code ratio of 3.7:1
- Comprehensive network failure scenario testing (7 distinct scenarios)
- Proper mock cleanup and timer verification
- Tests cover all retryable error codes
- Connection lifecycle state machine tested end-to-end

### Minor Issues

1. `device-api.test.ts` is very minimal (2 tests, happy-path only). It validates property types but not values or error scenarios.
2. One test in `reliability.test.ts` has a 20-second explicit timeout — may slow CI.
3. Some `c8 ignore` pragmas in source code exclude lines from coverage that could be tested.

**Test Score: 9/10**

---

## 7. CI/CD Assessment

### CI Workflow (`ci.yml`)

- **Matrix**: Node 20, 22, 24 × Homebridge 1.11.2, beta
- **Full lane**: lint → typecheck → test (with coverage upload)
- **Smoke lane**: Node 24 + HB beta (lighter)
- **Audit job**: `npm audit --audit-level=high`
- **Concurrency**: Cancel-in-progress for same ref
- **Permissions**: Minimal (`contents: read`)

**Assessment:** Professional matrix CI. Tests against both stable and beta Homebridge. ✅

### Release Workflow (`release.yml`)

- Semantic-release with plugins: commit-analyzer, release-notes, changelog, npm, git, github
- NPM provenance enabled (`NPM_CONFIG_PROVENANCE: "true"`)
- Runs full check suite before release
- Pinned plugin versions in release workflow

**Assessment:** Fully automated release pipeline with provenance. ✅

### Supply-Chain Workflow (`supply-chain.yml`)

- SBOM generation (CycloneDX format)
- OSV scanner (pinned to v2.3.3)
- Runs on push to main/work and all PRs

**Assessment:** Above-average for an OSS Homebridge plugin. ✅

### Dependabot

- npm: weekly, limit 10 PRs
- GitHub Actions: weekly, limit 5 PRs
- Labels configured

**Assessment:** Properly configured. ✅

**CI/CD Score: 10/10**

---

## 8. Critical Issues (Blockers for npm Publication)

**None identified.** The project is ready for npm publication.

All of the following pass:
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` (100% coverage) ✅
- `npm run build` ✅
- `npm audit` (0 vulnerabilities) ✅
- `npm pack --dry-run` (25 files, 20.7 kB) ✅

---

## 9. Recommended Improvements

### High Priority

| ID | Issue | File(s) | Recommendation |
|----|-------|---------|----------------|
| H1 | README missing `operationPollIntervalMs` and `sensorPollIntervalMs` in config table | README.md | Add these two fields to the Configuration fields table |
| H2 | README Filter Replace Alert description inverted | README.md | Fix: `CONTACT_NOT_DETECTED` (1) when replacement needed, `CONTACT_DETECTED` (0) when OK |
| H3 | README "Switch: Power" doesn't mention AirPurifier service | README.md | Update Features table to note AirPurifier service on HB 2.x, Switch fallback on 1.x |

### Medium Priority

| ID | Issue | File(s) | Recommendation |
|----|-------|---------|----------------|
| M1 | `setBuzzerVolume` is dead code (public but never called) | device-client.ts | Either remove or expose via config option + HomeKit service |
| M2 | `c8 ignore` pragmas reduce effective coverage | miio-transport.ts | Consider testing the ignored branches or documenting why they're untestable |
| M3 | `device-api.test.ts` too minimal | test/device-api.test.ts | Add error scenarios, parameter validation tests |

### Low Priority

| ID | Issue | File(s) | Recommendation |
|----|-------|---------|----------------|
| L1 | `@types/node` uses `^20.0.0` (may pull in Node 20 types even on Node 24) | package.json | Consider aligning with actual minimum target or leave as-is (low risk) |
| L2 | No `.nvmrc` file | root | Add `.nvmrc` with `20` for developer convenience |
| L3 | No pre-commit hooks (Husky/lint-staged) | root | Consider adding for developer workflow (CI catches issues, but local is faster) |
| L4 | `TRIAGE_DECISIONS.md` marked as deprecated | root | Remove from repository |
| L5 | Multiple audit report files in `docs/` | docs/ | Clean up old/redundant audit reports |

---

## 10. NPM Readiness Checklist

| Item | Status |
|------|--------|
| `package.json` name is valid npm name | ✅ `homebridge-xiaomi-air-purifier-modern` |
| `package.json` version | ✅ `1.0.0` |
| `package.json` description | ✅ Clear and accurate |
| `package.json` main entry point | ✅ `dist/index.js` |
| `package.json` types | ✅ `dist/index.d.ts` |
| `package.json` keywords | ✅ 16 relevant keywords |
| `package.json` engines | ✅ `node ^20 || ^22 || ^24`, `homebridge ^1.11.1 || ^2.0.0` |
| `package.json` homepage | ✅ GitHub URL |
| `package.json` repository | ✅ Git URL |
| `package.json` bugs | ✅ Issues URL |
| `package.json` license | ✅ `MIT` |
| `package.json` author | ✅ Name + URL |
| `package.json` files array | ✅ dist, config.schema.json, README, CHANGELOG, LICENSE, SECURITY, COC |
| `package.json` peerDependencies | ✅ `homebridge ^1.11.1 || ^2.0.0` |
| `package.json` displayName | ✅ Homebridge UI friendly name |
| `package.json` type | ✅ `commonjs` |
| `package.json` prepublishOnly script | ✅ lint + typecheck + test + build |
| `package.json` prepare script | ✅ build |
| LICENSE file | ✅ MIT |
| README.md | ✅ Comprehensive |
| CHANGELOG.md | ✅ Keep a Changelog format |
| CONTRIBUTING.md | ✅ Present |
| CODE_OF_CONDUCT.md | ✅ Contributor Covenant |
| SECURITY.md | ✅ With SLA table |
| config.schema.json | ✅ Homebridge UI schema |
| .gitignore | ✅ node_modules, dist, coverage, *.tgz |
| .npmrc | ✅ engine-strict=true |
| .editorconfig | ✅ Consistent formatting |
| package-lock.json | ✅ Committed |
| TypeScript strict mode | ✅ Maximum strictness |
| Linter configured | ✅ Biome with noExplicitAny |
| Tests pass | ✅ 84/84, 100% coverage |
| Build passes | ✅ tsc compiles cleanly |
| npm audit clean | ✅ 0 vulnerabilities |
| npm pack produces valid tarball | ✅ 25 files, 20.7 kB |
| CI pipeline | ✅ Matrix testing, audit |
| Release automation | ✅ semantic-release with provenance |
| Supply-chain security | ✅ SBOM + OSV scanner |
| Dependabot | ✅ npm + GitHub Actions |
| Issue templates | ✅ Bug report + Feature request |
| PR template | ✅ Present |

**Missing items:** None critical. Optional improvements (`.nvmrc`, pre-commit hooks) noted above.

---

## 11. Summary Scores

| Category | Score | Notes |
|----------|-------|-------|
| Homebridge 1.x/2.x Compliance | 49/50 | Excellent. Minor: README doesn't clarify AirPurifier vs Switch service |
| Code Quality | 9/10 | Clean architecture, strict TS, proper async. Minor: dead code (setBuzzerVolume) |
| Security & Supply Chain | 10/10 | Zero runtime deps, npm audit clean, SBOM, OSV, provenance |
| Test Quality | 9/10 | 100% coverage, excellent scenario testing. Minor: device-api tests too minimal |
| CI/CD | 10/10 | Professional matrix CI, semantic-release, supply-chain workflows |
| Documentation | 8/10 | Comprehensive but has 3 inaccuracies in README vs code |
| npm Readiness | 10/10 | All checklist items present and correct |
| **Overall** | **9.3/10** | **Ready for npm publication** |

---

*Report generated by automated code review. All findings verified against source code at commit `d8f26f6` on branch `main`.*
