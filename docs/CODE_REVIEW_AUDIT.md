# Code Review & Quality Audit – `xiaomi-mi-air-purifier-ng`

## Scope and method

Review covered:

- source (`src/**`), tests (`test/**`), docs, release/checklist files,
- package metadata (`package.json`, lockfile), schema (`config.schema.json`), TypeScript/Biome config,
- GitHub CI and Dependabot setup.

Commands used during audit included:

- `rg --files`
- `sed -n ...` and `nl -ba ...` for static inspection
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (all blocked by local npm runtime issue in this environment)

---

## Executive summary

1. **Core architecture is strong**: clear split between Homebridge accessory adapter, stateful client with retry/backoff, and low-level MIIO transport. This is a good base for long-term OSS maintenance.
2. **Reliability engineering is above average**: queueing, retry policy with jitter, reconnect lifecycle events, and dedicated resiliency tests are present.
3. **There is a publication blocker for npm/Homebridge ecosystem discoverability**: package name and repository naming are inconsistent (`homebridge-xiaomi-air-purifier-modern` vs repo `xiaomi-mi-air-purifier-ng`), and Homebridge metadata can be tightened.
4. **Compatibility declarations are too strict and unusual** (`node: ^20.20.0 || ^22.22.0 || ^24.13.0`), likely excluding valid LTS patch lines and creating avoidable install friction.
5. **Config schema and implementation drift exists**: schema exposes fields that code does not honor (`enableAirQuality`, `enableTemperature`, `enableHumidity`, `enableFanSpeedControl`, `enableChildLockControl`), which can mislead users.
6. **OSS governance/security docs are incomplete**: no `SECURITY.md`, no `CODE_OF_CONDUCT.md`, and no issue/PR templates.

---

## Critical problems (publication blockers)

1. **Schema/behavior mismatch (blocker)**
   - `config.schema.json` advertises feature toggles that are currently ignored by runtime code.
   - Risk: user-facing broken expectations in Homebridge UI and support burden.
   - Fix options:
     - implement the toggles in `AirPurifierAccessory` service creation/binding; or
     - remove unsupported keys from schema until implemented.

2. **Engines range likely too restrictive (blocker)**
   - `package.json` uses very specific minimum patch versions for Node 20/22/24.
   - Risk: otherwise compatible Homebridge hosts may fail installation due to `engines` checks.
   - Suggested change (safer): `"node": ">=20.0.0"` or `"^20.0.0 || ^22.0.0 || ^24.0.0"` depending on true runtime requirements.

3. **No security policy file (blocker for mature OSS posture)**
   - Missing `SECURITY.md` with vulnerability reporting process and supported versions.
   - Risk: unclear coordinated disclosure path.

4. **Release automation not production-grade (blocker for high-quality maintainability target)**
   - Current `release` script does manual patch bump + push tags.
   - No semantic-release/changesets, no automated changelog gating, no npm provenance or automation pipeline.
   - Risk: inconsistent releases and human error.

---

## Important improvements by priority

### High

- **Align schema and runtime configuration**
  - Implement/remove currently non-functional schema options.
- **Adopt explicit Homebridge plugin metadata**
  - Add `"displayName"`, `"platforms"/"pluginType"` clarity where applicable, verify plugin identifier consistency with README and schema.
- **Strengthen runtime validation**
  - Validate `token` as strict 32-hex (`/^[0-9a-fA-F]{32}$/`) before transport construction; currently `Buffer.from(..., "hex")` + length check can be bypassed by some malformed forms.
- **Add SECURITY policy and OSS governance basics**
  - `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates.

### Medium

- **Logging hardening**
  - Avoid full endpoint details in info logs by default (IP can be considered sensitive in some environments).
  - Introduce debug-only extended connection diagnostics.
- **Test strategy realism**
  - Coverage currently excludes `src/core/miio-transport.ts` while requiring 100% thresholds for included files. Add targeted tests for transport parser/packet framing with socket mocking.
- **CI efficiency and clarity**
  - Matrix over 3 Node versions * 4 jobs is expensive; consider splitting smoke matrix + full job on one LTS, or using reusable workflows.
- **Supply-chain hardening**
  - Add `npm audit --production` (or `npm audit --omit=dev`) in CI as non-blocking warning, with optional scheduled blocking policy.

### Low

- Add `funding` field in `package.json` (if applicable).
- Add `README` compatibility matrix per purifier model (validated vs experimental).
- Add deprecation policy section in docs for future breaking changes.

---

## Homebridge 1.x / 2.x compliance assessment

### Score

- **Homebridge 1.x readiness: 8.5/10**
- **Homebridge 2.x readiness: 7.5/10**

### Notes

- Good:
  - accessory registration is correct for accessory plugin mode,
  - startup/shutdown handled,
  - reconnect and polling behavior are robust,
  - characteristic refresh avoids unnecessary updates.
- Needs work:
  - verify and test Homebridge 2.x APIs once stable (currently `^2.0.0-beta.0` range is broad for a beta lineage),
  - improve service semantics for purifier control (consider optional `AirPurifier` service mapping alongside switches for richer Home UX),
  - improve config/schema consistency for Homebridge UI.

---

## Architecture & code quality findings

### Asynchrony / reliability

- Strong points:
  - serialized operation queue prevents command races,
  - retry/backoff with jitter is implemented,
  - retryable code list is broad and practical,
  - timers and retry delay are cleaned on shutdown.
- Risks:
  - listener arrays (`onStateUpdate`, `onConnectionEvent`) are append-only, no unsubscribe path; acceptable for current lifetime model but limits reuse/testing ergonomics.

### Typing / validation

- Strong:
  - strict TypeScript settings, explicit domain types.
- Gaps:
  - config validation primarily checks non-empty strings and numeric normalization; model value is asserted by cast, not guarded against unknown string at runtime.

### API/service design

- Strong:
  - clear separations (`platform` → accessory → client → transport).
- Gaps:
  - schema advertises optional capability toggles, but accessory always instantiates full service set (except optional filter alert sensor).

### Resource management

- Good timer cleanup.
- UDP socket lifecycle guarded against repeated close and known `ERR_SOCKET_DGRAM_NOT_RUNNING`.

### Performance

- Polling intervals are conservative and likely acceptable for LAN MIIO.
- Could add adaptive polling (faster briefly after writes, slower when stable/offline) as future optimization.

### Logging

- No obvious token leakage in logs.
- Connection logs include accessory name + IP; acceptable but worth making configurable for privacy-sensitive installs.

---

## Security & supply-chain audit

### Security posture

- **Positive**
  - token is not logged,
  - local LAN control design avoids cloud credentials in runtime,
  - retries classify transient transport failures correctly.
- **Risks / improvements**
  - MIIO uses local UDP + symmetric token protocol; cannot be "fully secure" by modern zero-trust standards. Document LAN trust assumptions clearly.
  - Introduce security disclosure workflow (`SECURITY.md`).

### Dependency posture

- Dependency footprint is small and modern (TS, Vitest, Biome only for dev).
- Lockfile exists (`package-lock.json`) – good for reproducible CI.
- Dependabot for npm + GitHub Actions is correctly configured.

### Recommended hardening additions

- CI step: `npm audit --omit=dev` (warning mode first).
- Optional: generate SBOM (CycloneDX) in CI artifacts.
- Optional: provenance-based publish (`npm publish --provenance`) in release workflow.

---

## Tests, CI/CD, release process

### Current state

- Tests: present and meaningful for core logic/reliability paths.
- Lint/typecheck/build scripts exist.
- CI matrix runs lint/typecheck/test/build on Node 20/22/24.
- Dependabot present for npm and GitHub Actions.

### Gaps

- local command execution in this audit environment failed due npm runtime/tooling issue, so runtime verification from this environment is incomplete.
- No dedicated release workflow for npm publish.
- Coverage setup excludes transport file; this should be explicitly justified or reduced to realistic thresholds per layer.

### Professional release recommendation

- Adopt one of:
  - `semantic-release` + Conventional Commits, or
  - `changesets`.
- Automate:
  - versioning,
  - changelog generation,
  - git tag + GitHub release,
  - npm publish (with OIDC provenance).

---

## "Gotowe do npm" checklist

- [x] `README.md` with installation/configuration
- [x] `CHANGELOG.md`
- [x] `CONTRIBUTING.md`
- [x] CI workflow
- [x] Dependabot config
- [x] TypeScript config
- [x] Lint/format config
- [x] `package-lock.json`
- [x] `license` field in `package.json`
- [ ] `LICENSE` file in repo root (recommended to add explicit file)
- [ ] `SECURITY.md`
- [ ] `CODE_OF_CONDUCT.md`
- [ ] issue templates / PR template
- [ ] automated release workflow (semantic-release/changesets)
- [ ] schema-to-runtime feature parity

---

## Concrete file-level recommendations

### 1) `package.json` (engines/release metadata)

Suggested fragment:

```json
{
  "engines": {
    "node": "^20.0.0 || ^22.0.0 || ^24.0.0",
    "homebridge": "^1.11.1 || ^2.0.0"
  },
  "scripts": {
    "release": "semantic-release"
  }
}
```

### 2) Add `SECURITY.md`

Minimum content:

- supported versions table,
- report channel (email/private advisory),
- expected response SLA,
- disclosure policy.

### 3) Align `config.schema.json` with runtime

Either:

- remove unsupported keys (`enableAirQuality`, `enableTemperature`, `enableHumidity`, `enableFanSpeedControl`, `enableChildLockControl`),

or:

- implement conditional service creation and handler binding controlled by those flags.

### 4) CI hardening (new workflow or extend existing)

Recommended additions:

- `npm audit --omit=dev` (warning initially),
- release workflow triggered by tags/merge to main with protected environment,
- npm provenance publish.

### 5) Homebridge service mapping enhancement

Consider optional advanced mode exposing HomeKit `AirPurifier` service (where semantics fit device model), keeping current switch-based compatibility mode as default.

---

## Final verdict

Project is already **solid technically** and close to production-quality OSS. Main work before high-confidence npm publication is **operational/governance hardening** and **schema/runtime consistency cleanup** rather than deep transport refactor.
