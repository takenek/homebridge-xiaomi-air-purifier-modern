# Homebridge Plugin Audit Report — v11

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-03-08
**Audytor:** Claude Opus 4.6 — niezależny pełny code review, security audit, quality assessment
**Metoda:** Kompletna analiza każdego pliku repozytorium: 9 plików źródłowych (2292 LOC), 13 plików testowych + helpers (4732 LOC), 6 workflows GitHub Actions, konfiguracje (biome.json, tsconfig.json, tsconfig.test.json, vitest.config.ts, .releaserc.json, config.schema.json, .editorconfig, .npmrc, .gitignore), dokumentacja (README.md, CHANGELOG.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, RELEASE_CHECKLIST.md, LICENSE). Analiza ostatnich 10 commitów. Wszystkie komendy weryfikacyjne uruchomione i wyniki udokumentowane.

### Komendy weryfikacyjne (uruchomione z `env -u npm_config_http_proxy -u npm_config_https_proxy`):

| Komenda | Wynik |
|---------|-------|
| `npm ci` | ✅ 114 packages, 0 vulnerabilities |
| `npm run lint` | ✅ "Checked 30 files in 56ms. No fixes applied." |
| `npm run typecheck` | ✅ Clean (0 errors) |
| `npm test` (vitest --coverage) | ✅ 126 tests passed, 13 test files, 100% coverage (all metrics) |
| `npm run build` | ✅ Clean TypeScript compilation |
| `npm audit` | ✅ "found 0 vulnerabilities" |
| `npm outdated` | ✅ Only `@types/node` 22.x vs 25.x (correct for engines) |
| `npm ls --all` (deprecated check) | ✅ Only q@1.1.2 (transitive: homebridge 1.x) — expected |
| `npm pack --dry-run` | ✅ 34 files, 37.2 kB packed, 163.7 kB unpacked |

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka używa wyłącznie `node:crypto` i `node:dgram`. Supply-chain risk jest praktycznie zerowy — to wybitne osiągnięcie wśród wtyczek Homebridge.

2. **126 testów w 13 plikach z wymuszonym 100% pokryciem kodu** — vitest.config.ts wymusza 100% na statements/branches/functions/lines. Suite obejmuje 9 realistycznych scenariuszy sieciowych (S1-S9), crypto round-trip, pełne coverage transportu MIIO/MIOT, kompletne branch coverage DeviceClient i dobrze zorganizowane testy modułowe.

3. **Profesjonalny CI/CD z supply-chain hardening** — semantic-release z npm provenance, SBOM CycloneDX, OSV Scanner, OpenSSF Scorecard, Dependabot (npm + GitHub Actions), macierz CI Node 20/22/24 × Homebridge 1.11.2/beta, SHA-pinned GitHub Actions z komentarzami wersji.

4. **Solidna architektura warstwowa z SRP** — `MiioTransport → DeviceClient → AirPurifierAccessory → XiaomiAirPurifierPlatform`. Operation queue serializująca UDP, retry z exponential backoff + jitter, dual protocol (MIOT/Legacy) z auto-detekcją i runtime fallback.

5. **Pełna trójstronna spójność** — README ↔ config.schema.json ↔ kod źródłowy (platform.ts) — wszystkie domyślne wartości, limity, mapowania i nazwy pól identyczne w trzech źródłach.

6. **Kompletna dokumentacja i community standards** — README z pełną konfiguracją, troubleshooting, AQI mapping, network hardening. CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, CODEOWNERS, RELEASE_CHECKLIST.

### Główne ryzyka / obszary do poprawy

1. **Liczne type casts (`as never`, `as unknown as`)** — wymuszone przez kompatybilność HB 1.x/2.x API, ale utrudniają statyczną analizę. Uzasadnione, lecz warte obserwacji przy ewolucji API.

2. **Semantic-release plugins version-pinned, ale nie integrity-pinned** — standardowa praktyka, ale warto mieć świadomość ryzyka supply-chain w runtime release pipeline.

---

## 2. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/                            2292 LOC (9 plików)
│   ├── index.ts                    Entry point — registerPlatform (10 LOC)
│   ├── platform.ts                 Platform plugin, config validation, DI (301 LOC)
│   ├── accessories/
│   │   └── air-purifier.ts         HomeKit service/characteristic binding (675 LOC)
│   └── core/
│       ├── device-client.ts        Polling, retry, operation queue (317 LOC)
│       ├── miio-transport.ts       MIIO/MIOT UDP protocol, crypto (796 LOC)
│       ├── mappers.ts              Fan level ↔ %, AQI → HomeKit quality (40 LOC)
│       ├── mode-policy.ts          Auto/Night switch state machine (29 LOC)
│       ├── retry.ts                Exponential backoff + retryable error codes (76 LOC)
│       └── types.ts                Shared types + property list (48 LOC)
├── test/                           4732 LOC (13 plików testowych + helpers)
│   ├── helpers/
│   │   └── fake-homekit.ts         Shared test infrastructure (274 LOC)
│   ├── accessory.test.ts                  (901 LOC, 14 tests)
│   ├── platform.test.ts                   (492 LOC, 14 tests)
│   ├── config-validation.test.ts          (80 LOC, 7 tests)
│   ├── device-client-branches.test.ts     (607 LOC, 25 tests)
│   ├── miio-transport-commands.test.ts    (598 LOC, 11 tests)
│   ├── miio-transport-protocol.test.ts    (497 LOC, 10 tests)
│   ├── miio-transport-reliability.test.ts (384 LOC, 8 tests)
│   ├── network-scenarios.test.ts          (309 LOC, 9 tests)
│   ├── device-api.test.ts                (199 LOC, 7 tests)
│   ├── reliability.test.ts               (189 LOC, 5 tests)
│   ├── crypto-roundtrip.test.ts          (97 LOC, 3 tests)
│   ├── mappers.test.ts                   (72 LOC, 9 tests)
│   └── mode-policy.test.ts              (33 LOC, 4 tests)
├── .github/
│   ├── workflows/                  6 workflows (ci, release, supply-chain, scorecard, stale, labeler)
│   ├── dependabot.yml, CODEOWNERS, labeler.yml
│   ├── ISSUE_TEMPLATE/             bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── docs/                           reliability-test-plan.md
├── config.schema.json              Homebridge UI schema + layout (240 LOC)
├── biome.json / tsconfig.json / tsconfig.test.json / vitest.config.ts
├── .releaserc.json / .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
└── README.md / CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
    LICENSE / SECURITY.md / RELEASE_CHECKLIST.md / AUDIT_REPORT.md
```

**Ocena struktury: 10/10.** Czysty podział na warstwy z przestrzeganiem SRP. Brak "god objects". Shared test infrastructure wyodrębniona. Każdy moduł core ma jedną wyraźną odpowiedzialność. Testy podzielone na 13 fokusowych plików z jasnym single-responsibility.

---

## 3. Zgodność ze standardami Homebridge 1.x i 2.x

### 3.1 Rejestracja i lifecycle

| Aspekt | Status | Dowód w kodzie |
|--------|--------|----------------|
| `registerPlatform` (Dynamic Platform) | ✅ | `index.ts:8-10` — `api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ...)` |
| `pluginAlias` match | ✅ | `XiaomiMiAirPurifier` = `PLATFORM_NAME` = `config.schema.json:pluginAlias` |
| `pluginType: "platform"` | ✅ | `config.schema.json:3` |
| `singular: true` | ✅ | `config.schema.json:4` |
| `displayName` w package.json | ✅ | `package.json:73` — "Xiaomi Mi Air Purifier Modern" |
| `DynamicPlatformPlugin` interface | ✅ | `platform.ts:125` — `implements DynamicPlatformPlugin` |
| `configureAccessory` for cache restore | ✅ | `platform.ts:147-150` — pushes to `cachedAccessories` array |
| `didFinishLaunching` event | ✅ | `platform.ts:142-144` — `api.on("didFinishLaunching", ...)` |
| Stale accessory cleanup | ✅ | `platform.ts:162-176` — compares `activeAccessoryUuids` and calls `unregisterPlatformAccessories` |
| Non-blocking init | ✅ | `air-purifier.ts:166-172` — `void client.init().then(...).catch(...)` |
| Shutdown handler | ✅ | `air-purifier.ts:174-179` — `api.on("shutdown", ...)` z `void client.shutdown().catch(...)` |
| Timer cleanup on shutdown | ✅ | `device-client.ts:279-301` — `clearTimers()` clears 4 timers + resolves pending delay |
| Timer `.unref()` | ✅ | All timers (operation, sensor, keepAlive, retry) — nie blokują graceful exit |
| Socket cleanup | ✅ | `miio-transport.ts:278-305` — idempotent `close()` z `socketClosed` guard |
| Error isolation | ✅ | Shutdown, init, listener errors — all caught and logged |

### 3.2 Reconnect i retry

| Aspekt | Status | Dowód w kodzie |
|--------|--------|----------------|
| Exponential backoff z jitter | ✅ | `retry.ts:15-25` — base=400ms, configurable cap, 20% jitter |
| 16 retryable error codes | ✅ | `retry.ts:27-45` — ETIMEDOUT, ECONNRESET, ENETDOWN, EHOSTUNREACH, EAI_AGAIN, itd. |
| `EDEVICEUNAVAILABLE` reduced retries | ✅ | `retry.ts:47,62-76` — max 2 retries for device-specific errors |
| Connection lifecycle events | ✅ | `device-client.ts:217-224` — connected/disconnected/reconnected |
| Session re-handshake on transport error | ✅ | `miio-transport.ts:593-604` — `call()` invalidates session and re-handshakes |
| `destroyed` flag during retry | ✅ | `device-client.ts:198,264` — checked in `pollWithRetry` and `delay` |
| Queue error isolation | ✅ | `device-client.ts:180-184` — rejected operations don't block subsequent ones |

### 3.3 Mapowanie HomeKit characteristics

| Funkcja oczyszczacza → HomeKit | Status | Dowód |
|--------------------------------|--------|-------|
| Power ON/OFF | ✅ | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch:On` (HB 1.x) |
| CurrentAirPurifierState | ✅ | INACTIVE / IDLE / PURIFYING_AIR — 3 stany poprawnie mapowane |
| TargetAirPurifierState | ✅ | onGet + onSet: AUTO→"auto", MANUAL→"favorite" |
| RotationSpeed | ✅ | `mappers.ts:4-14` — fan level 1-16 ↔ 0-100% z clamping |
| AirQuality sensor | ✅ | `mappers.ts:18-40` — 6 progów z UNKNOWN dla NaN/<0 |
| PM2.5 Density | ✅ | `air-purifier.ts:517` — clamped [0, 1000] |
| Temperature / Humidity sensors | ✅ | Opcjonalne, domyślnie włączone |
| Filter Maintenance | ✅ | `FilterLifeLevel` + `FilterChangeIndication` z configurable threshold |
| Filter Alert (ContactSensor) | ✅ | Opcjonalny, `exposeFilterReplaceAlertSensor` |
| Child Lock switch | ✅ | Opcjonalny, `enableChildLockControl` |
| LED Night Mode switch | ✅ | Switch z `set_led` / `get_led` (MIOT + Legacy) |
| Mode AUTO ON/OFF | ✅ | ON=auto, OFF=sleep; guard when power OFF |
| Mode NIGHT ON/OFF | ✅ | ON=sleep, OFF=auto; guard when power OFF |
| AccessoryInformation | ✅ | Manufacturer, Model, Name, SerialNumber |
| ConfiguredName (dynamic) | ✅ | `getOptionalProperty` sprawdza dostępność w runtime |
| Stale service removal | ✅ | `removeStaleServices` porównuje active vs all services na platformAccessory |

### 3.4 Kompatybilność wersji

| Aspekt | Status |
|--------|--------|
| `engines.homebridge`: `^1.11.1 \|\| ^2.0.0` | ✅ |
| `peerDependencies` = `engines.homebridge` | ✅ |
| `engines.node`: `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` | ✅ |
| CI matrix: Node 20/22/24 × HB 1.11.2/beta | ✅ |
| Dynamic `AirPurifier` service detection | ✅ (`getOptionalProperty`) |
| Dynamic `ConfiguredName` characteristic detection | ✅ |
| Enum fallbacks via `getNumericEnum` | ✅ |

### Ocena zgodności Homebridge: **10/10**

---

## 4. Jakość kodu (Node.js / TypeScript)

### 4.1 Typowanie

| Aspekt | Status |
|--------|--------|
| `strict: true` + `noImplicitAny` | ✅ |
| `noUnusedLocals` + `noUnusedParameters` | ✅ |
| `noUncheckedIndexedAccess` | ✅ |
| `exactOptionalPropertyTypes` | ✅ |
| `noExplicitAny: error` (Biome linter) | ✅ |
| Target ES2022, module CommonJS | ✅ |
| Declaration files (`declaration: true`) | ✅ |
| Source maps enabled | ✅ |

**Komentarz:** Najsurowsze flagi TypeScript. `noUncheckedIndexedAccess` i `exactOptionalPropertyTypes` to rzadko włączane opcje — ich obecność świadczy o wysokiej dyscyplinie null safety. Biome z `noExplicitAny: error` dodatkowo wzmacnia type safety.

### 4.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | ✅ | Brak mieszania callbacks z promises |
| Operation queue (FIFO serialization) | ✅ | `enqueueOperation` zapobiega race conditions na UDP socket |
| Queue error isolation | ✅ | Rejected operacja logowana debug, nie blokuje kolejnych |
| Fire-and-forget safety | ✅ | `void promise.catch(...)` pattern — brak unhandled rejections |
| Listener error isolation | ✅ | try/catch wokół state i connection listener callbacks |
| Socket error handler | ✅ | `socket.on("error", ...)` zapobiega process crash |
| Error typing | ✅ | Consistent `error instanceof Error ? error.message : String(error)` |
| Timeout handling | ✅ | `setTimeout` z `cleanup()` pattern w `sendAndReceive` |

**Uwaga architektoniczna:** Wzorzec operation queue (`enqueueOperation`) jest solidnie zaprojektowany — chain promises z release resolve, FIFO ordering, error isolation. Wzorowy pattern dla UDP-based transports.

### 4.3 Zasoby i zarządzanie pamięcią

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | ✅ | Centralne `clearTimers()` + resolve pending delay promise |
| Socket cleanup | ✅ | Idempotent z `socketClosed` flag + `ERR_SOCKET_DGRAM_NOT_RUNNING` guard |
| Listener unsubscribe | ✅ | `onStateUpdate`/`onConnectionEvent` zwracają cleanup fn |
| `characteristicCache` bounded | ✅ | Stały zbiór ~20 characteristics — nie rośnie |
| `.unref()` na timerach | ✅ | Nie blokuje graceful process exit |
| Event listener cleanup | ✅ | `socket.off("message"/"error")` w `sendAndReceive` cleanup |
| MessageId overflow protection | ✅ | `(nextMessageId % 2_147_483_647) + 1` — safe wrap-around |
| No memory leaks | ✅ | Stale listeners filtrowane, timery cleared, socket zamykany |

### 4.4 Protokół MIIO/MIOT — analiza implementacji

**Szyfrowanie (AES-128-CBC):**
```
key = MD5(token)
iv  = MD5(key || token)
```
Standard protokołu Xiaomi MIIO. Static IV to ograniczenie protokołu, nie kodu. Testowany w `crypto-roundtrip.test.ts` — 3 testy: round-trip, different tokens produce different ciphertext, various payload sizes.

**Detekcja protokołu (MIOT vs Legacy):**
1. Próba `get_properties` z MIOT probe (siid:2, piid:2) → sukces = MIOT
2. Fallback: `get_prop` z legacy `["power"]` → sukces = legacy
3. Oba fail → `null` → default `"legacy"`
4. Runtime fallback: jeśli MIOT error (non-retryable) → switch to legacy
5. Defensive: jeśli legacy zwraca all-empty core fields → retry MIOT once

**LED mapping — poprawne rozróżnienie MIOT vs Legacy:**

| Tryb | Właściwość | Wartości | Konwersja |
|------|-----------|---------|-----------|
| MIOT | `led` (siid:6, piid:1) | 0=bright, 1=dim, 2=off | `toNumber(v) !== 2` |
| Legacy | `led` ("on"/"off") | string | `toBoolean(v)` |
| Legacy | `led_b` (fallback) | 0=bright, 1=dim, 2=off | `toLegacyLed(v)` — specific numeric handler |

**MIOT batch optimization:**
Single `get_properties` call z ~20 parametrami. Fallback na per-property reads (`readMiotOne`) jeśli batch nie jest obsługiwany przez firmware. Deduplication via signature set.

**Set fan level (MIOT):**
Atomowe ustawienie `mode=favorite` + `fan_level` w jednym batch `set_properties` call. Poprawne — udokumentowane w README (Rotation Speed section).

**Response checksum verification:**
MD5 checksum response weryfikowany (`miio-transport.ts:682-695`). W przypadku mismatch → logowanie ostrzeżenia (best-effort diagnostic). Poprawne podejście dla LAN-only UDP.

### 4.5 Logowanie

| Aspekt | Status |
|--------|--------|
| Token nigdy nie logowany | ✅ — zweryfikowane: zero referencji do `token` w log calls |
| Address masking (`maskDeviceAddressInLogs`) | ✅ — `maskAddress()` zwraca `x.y.*.*` |
| SerialNumber uses `displayAddress` | ✅ — `buildSerialNumber(displayAddress)` |
| Poziomy logowania: debug/info/warn/error | ✅ — poprawne użycie wg severity |
| Suppressed errors: `process.emitWarning` z context tagiem | ✅ |
| Connection lifecycle events logowane | ✅ — connected/disconnected/reconnected z IP |

### 4.6 Styl kodu

| Aspekt | Status |
|--------|--------|
| Biome linter (recommended + `noExplicitAny: error`) | ✅ |
| Biome formatter (space indent) | ✅ |
| EditorConfig (UTF-8, LF, 2-space) | ✅ |
| Consistent naming conventions | ✅ |
| No magic numbers (stałe + config) | ✅ |
| No dead code / unused imports | ✅ |
| Consistent error message format | ✅ |

**Ocena jakości kodu: 9.5/10** — drobne zastrzeżenia dotyczą `as never`/`as unknown as` type casts, uzasadnione kompatybilnością HB 1.x/2.x.

---

## 5. Security & Supply Chain

### 5.1 Wrażliwe dane

| Aspekt | Status | Dowód |
|--------|--------|-------|
| Token w logach | ✅ Nigdy | Żaden `log.*()` call nie zawiera `token` |
| Token w `error.message` | ✅ Nigdy | Komunikaty błędów nie zawierają tokenu |
| Token walidacja | ✅ | `platform.ts:63-68` — regex `^[0-9a-fA-F]{32}$` + `config.schema.json` pattern |
| IP masking | ✅ | `platform.ts:46-53` — `maskAddress()` z propagacją do `displayAddress` |
| SerialNumber masking | ✅ | `air-purifier.ts:638-639` — `buildSerialNumber(displayAddress)` |
| Config token: password-type hint w UI | ⚠️ | `config.schema.json` nie deklaruje `"x-schema-form": {"type": "password"}` — w Homebridge UI token jest widoczny plain-text. Nie jest blokerem, ale poprawa UX. |

### 5.2 Protokół sieciowy

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| AES-128-CBC szyfrowanie | ✅ | Standard MIIO |
| Static IV | ℹ️ | Ograniczenie protokołu Xiaomi, nie kodu |
| Message ID filtering | ✅ | `sendAndReceive` filtruje response po ID (bytes 4-7) |
| MIIO magic validation | ✅ | Sprawdzenie `0x2131` + response length ≥ 32 |
| Response checksum verification | ✅ | MD5 checksum verified, mismatch → warning |
| WAN exposure | ✅ Brak | Tylko LAN UDP 54321 |
| README network hardening | ✅ | VLAN, ACL, egress blocking rekomendowane |
| No command injection | ✅ | `JSON.stringify` z typami, brak string interpolacji w komendach |
| No unsafe `eval`/`Function` | ✅ | Żadne wystąpienie |

### 5.3 Dependencies & Supply Chain

| Aspekt | Status |
|--------|--------|
| **Runtime dependencies: 0** | ✅ |
| `package-lock.json` (lockfileVersion 3) | ✅ |
| `engine-strict=true` w `.npmrc` | ✅ |
| Dependabot (npm weekly + Actions weekly) | ✅ |
| SHA-pinned GitHub Actions | ✅ (9 actions, all pinned to commit SHA) |
| SBOM CycloneDX (via `npm sbom`) | ✅ |
| OSV Scanner | ✅ |
| OpenSSF Scorecard | ✅ |
| npm provenance (`NPM_CONFIG_PROVENANCE: true`) | ✅ |
| Minimal workflow permissions (PoLP) | ✅ |
| `files` whitelist in package.json | ✅ |
| No secrets in code | ✅ |
| `npm audit`: 0 vulnerabilities | ✅ (zweryfikowane) |
| Deprecated packages | ✅ Tylko q@1.1.2 (transitive: homebridge → hap-nodejs → node-persist) |

### 5.4 CI Security

| Aspekt | Status |
|--------|--------|
| Concurrency with `cancel-in-progress` | ✅ |
| `npm audit --audit-level=high` w CI | ✅ (ci.yml + release.yml) |
| Pre-release gates: audit → check → release | ✅ |
| `fetch-depth: 0` only in release (needed for semantic-release) | ✅ |
| `persist-credentials: false` w scorecard | ✅ |
| Minimal `id-token: write` only for provenance/OIDC | ✅ |
| `pull_request_target` for labeler (correct for external PRs) | ✅ |
| Default permissions `contents: read` | ✅ |

### 5.5 Release workflow — supply chain note

Semantic-release plugins w `release.yml` są version-pinned (np. `@semantic-release/changelog@6.0.3`) ale nie integrity-pinned (brak npm integrity hash). Instalowane w runtime przez `cycjimmy/semantic-release-action`. Standardowa praktyka, ale compromised npm package mógłby wpłynąć na release. Ryzyko niskie dzięki npm provenance i audit gate.

**Ocena security: 9.5/10** — brak krytycznych problemów; nota o release plugin pinning i brakującym password hint w UI.

---

## 6. Testy i CI/CD

### 6.1 Testy

| Metryka | Wartość |
|---------|---------|
| Framework | vitest v4.0.18 |
| Coverage provider | v8 |
| Testy | 126 (100% pass) |
| Pliki testowe | 13 |
| Shared helpers | 1 (`test/helpers/fake-homekit.ts`, 274 LOC) |
| Pokrycie statements | 100% (enforced w vitest.config.ts) |
| Pokrycie branches | 100% (enforced) |
| Pokrycie functions | 100% (enforced) |
| Pokrycie lines | 100% (enforced) |
| Test duration | 3.45s |

**Testy według pliku:**

| Plik | Testów | LOC | Zakres pokrycia |
|------|--------|-----|-----------------|
| `accessory.test.ts` | 14 | 901 | HomeKit service bindings, characteristic updates, feature flags, connection events |
| `platform.test.ts` | 14 | 492 | Platform lifecycle, device discovery, cached accessory restore, stale cleanup |
| `device-client-branches.test.ts` | 25 | 607 | Queue, retry, listeners, timers, error isolation, EDEVICEUNAVAILABLE cap |
| `miio-transport-commands.test.ts` | 11 | 598 | MIOT/legacy set commands, fan level, child lock, LED, mode switching |
| `miio-transport-protocol.test.ts` | 10 | 497 | Protocol detection, handshake, batch reads, MIOT/legacy fallback |
| `network-scenarios.test.ts` | 9 | 309 | S1-S9: realistic network failure/recovery + filter lifecycle |
| `mappers.test.ts` | 9 | 72 | Fan level mapping, AQI thresholds, boundary values |
| `miio-transport-reliability.test.ts` | 8 | 384 | Retryable errors, close idempotency, diagnostics |
| `device-api.test.ts` | 7 | 199 | Read/write API contract, parameter encoding, set-and-sync |
| `config-validation.test.ts` | 7 | 80 | Config normalization: threshold, timeout, boolean, hex token, model |
| `reliability.test.ts` | 5 | 189 | Backoff computation, error classification, socket error |
| `mode-policy.test.ts` | 4 | 33 | Auto/Night switch state machine |
| `crypto-roundtrip.test.ts` | 3 | 97 | AES-128-CBC encrypt/decrypt round-trip, token differentiation |

**Mocne strony testów:**
- Dobrze zorganizowana struktura — 13 fokusowych plików z jasnym single-responsibility (refaktoryzacja z wcześniejszych dużych plików zakończona)
- Shared test infrastructure (`fake-homekit.ts`) — `FakeService`, `FakeCharacteristic`, `FakeClient`, `FakePlatformAccessory`, `makeApi()`, `makeState()`, `makeLogger()`
- DI-based mocking (interfejsy `MiioTransport`, `Logger`) — clean architecture
- `ScriptedTransport` z queue-based reads — deterministic sequencing
- `FakeSocket` dla UDP layer — brak potrzeby rzeczywistego socketa
- `vi.useFakeTimers()` z kontrolowanym time-advancement
- 9 realistycznych scenariuszy sieciowych (restart urządzenia, router, packet loss, Wi-Fi outage, filter lifecycle)
- Isolation testów: proper cleanup w `afterEach`

### 6.2 CI Pipeline

| Workflow | Trigger | Opis |
|----------|---------|------|
| `ci.yml` | push main + PR | 5-node matrix: lint + typecheck + test(coverage) + audit |
| `release.yml` | push main | audit → check (lint+typecheck+test+build) → semantic-release → npm publish |
| `supply-chain.yml` | push main + PR | SBOM CycloneDX + OSV Scanner |
| `scorecard.yml` | push main + weekly cron | OpenSSF Scorecard → SARIF → CodeQL upload |
| `labeler.yml` | PR open/sync/reopen | Auto-labels (src, test, ci, docs, deps) |
| `stale.yml` | weekly cron | Stale issue/PR cleanup (60+14 days) |

**CI Matrix:**

| Node | Homebridge | Lane |
|------|------------|------|
| 20 | 1.11.2 | full |
| 22 | 1.11.2 | full |
| 24 | 1.11.2 | full |
| 22 | beta (2.x) | full |
| 24 | beta (2.x) | smoke |

**CI correctness verification:**

- ✅ `npm ci` runs `prepare` → `npm run build`, so TypeScript compilation happens first
- ✅ `npm install --no-save homebridge@${{ matrix.homebridge }}` installs target HB version after `npm ci`
- ✅ `typecheck` verifies types against installed HB version
- ✅ Coverage artifacts uploaded for `full` lane (with `if: always()`)
- ✅ Concurrency with `cancel-in-progress: true` — saves CI minutes on rapid pushes
- ✅ `fail-fast: false` — all matrix configurations tested independently
- ✅ Audit job is separate from test job — independent failure tracking
- ✅ Supply chain job runs on push main + PR — catches vulnerabilities before merge

### 6.3 Release Pipeline

| Aspekt | Status |
|--------|--------|
| semantic-release v24 | ✅ |
| Conventional commits (required by `commit-analyzer`) | ✅ |
| Auto-generated changelog | ✅ (`@semantic-release/changelog`) |
| Git tag + GitHub release | ✅ |
| npm publish z provenance | ✅ (`NPM_CONFIG_PROVENANCE: true`) |
| Pre-release gates: audit + check | ✅ |
| `check` = lint + typecheck + test + build | ✅ |
| `prepublishOnly` = lint + typecheck + test + build | ✅ |
| Release branch: `main` | ✅ (`.releaserc.json` + workflow trigger) |
| Assets committed: CHANGELOG.md, package.json, package-lock.json | ✅ |
| `id-token: write` for npm provenance OIDC | ✅ |

### 6.4 GitHub Actions SHA Pinning — weryfikacja

| Action | SHA | Wersja | Użyte w |
|--------|-----|--------|---------|
| `actions/checkout` | `de0fac2e4500...` | v6.0.2 | ci, release, supply-chain, scorecard |
| `actions/setup-node` | `49933ea52888...` | v4.4.0 | ci, release, supply-chain |
| `actions/upload-artifact` | `bbbca2ddaa5d...` | v7.0.0 | ci, supply-chain, scorecard |
| `actions/stale` | `b5d41d4e1d5d...` | v10.2.0 | stale |
| `actions/labeler` | `8558fd74291d...` | v5.0.0 | labeler |
| `cycjimmy/semantic-release-action` | `b12c8f6015dc...` | v6.0.0 | release |
| `ossf/scorecard-action` | `f49aabe0b5af...` | v2.4.1 | scorecard |
| `github/codeql-action/upload-sarif` | `0d579ffd059c...` | v4.32.6 | scorecard |
| `google/osv-scanner-action` | `c5996e019...` | v2.3.3 | supply-chain |

**Ocena:** Wszystkie 9 unique actions SHA-pinned z komentarzem wersji. Zgodne z OpenSSF best practices.

### 6.5 Dependabot

| Aspekt | Status |
|--------|--------|
| npm ecosystem (weekly) | ✅ |
| GitHub Actions ecosystem (weekly) | ✅ |
| Open PR limit: npm=10, actions=5 | ✅ |
| Labels: `dependencies`, `github-actions` | ✅ |

### 6.6 GitHub Community Standards

| Element | Status |
|---------|--------|
| Issue templates (bug + feature, YAML forms) | ✅ |
| `blank_issues_enabled: false` | ✅ |
| PR template (z checklist: lint, typecheck, test, changelog) | ✅ |
| CODEOWNERS (`* @takenek`) | ✅ |
| Auto-labeling config (src, test, ci, docs, deps) | ✅ |
| Stale management (60d stale + 14d close) | ✅ |
| Exempt labels: pinned, security, bug | ✅ |

**Ocena CI/CD: 10/10**

---

## 7. Weryfikacja README vs Kod (trójstronna)

### 7.1 Pola konfiguracji — domyślne wartości i limity

| Pole | README | config.schema.json | platform.ts | ✅/❌ |
|------|--------|-------------------|-------------|-------|
| `enableAirQuality` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableTemperature` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableHumidity` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableChildLockControl` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |
| `filterChangeThreshold` | default 10, [0,100] | `"default": 10, min 0, max 100` | `normalizeThreshold` clamp + default 10 | ✅ |
| `exposeFilterReplaceAlertSensor` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |
| `connectTimeoutMs` | 15000, min 100 | `"default": 15000, min 100` | `normalizeTimeout(…, 15_000)` | ✅ |
| `operationTimeoutMs` | 15000, min 100 | `"default": 15000, min 100` | `normalizeTimeout(…, 15_000)` | ✅ |
| `reconnectDelayMs` | 15000 (max cap) | `"default": 15000, min 100` | `maxDelayMs: reconnectDelayMs` | ✅ |
| `keepAliveIntervalMs` | 60000, min 1000 | `"default": 60000, min 1000` | `normalizeTimeout(…, 60_000, 1_000)` | ✅ |
| `operationPollIntervalMs` | 10000, min 1000 | `"default": 10000, min 1000` | `normalizeTimeout(…, 10_000, 1_000)` | ✅ |
| `sensorPollIntervalMs` | 30000, min 1000 | `"default": 30000, min 1000` | `normalizeTimeout(…, 30_000, 1_000)` | ✅ |
| `maskDeviceAddressInLogs` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |

**Pełna trójstronna spójność: README ↔ config.schema.json ↔ platform.ts** ✅

### 7.2 AQI mapping — README vs kod

| README | mappers.ts | ✅/❌ |
|--------|------------|-------|
| AQI < 0 / NaN = UNKNOWN (0) | `!isFinite \|\| <0 → 0` | ✅ |
| AQI 0–35 = Excellent (1) | `aqi <= 35 → 1` | ✅ |
| AQI 36–75 = Good (2) | `aqi <= 75 → 2` | ✅ |
| AQI 76–115 = Fair (3) | `aqi <= 115 → 3` | ✅ |
| AQI 116–150 = Poor (4) | `aqi <= 150 → 4` | ✅ |
| AQI >150 = Inferior (5) | `return 5` | ✅ |
| PM2.5 = raw AQI [0, 1000] | `Math.min(1000, Math.max(0, state.aqi))` | ✅ |

### 7.3 Supported models — trójstronna

| Źródło | Modele | Spójne? |
|--------|--------|---------|
| README | 2h, 3, 3h, 4, pro | ✅ |
| `config.schema.json` enum | 2h, 3, 3h, 4, pro | ✅ |
| `platform.ts` SUPPORTED_MODELS | 2h, 3, 3h, 4, pro | ✅ |

### 7.4 README configuration example

| Aspekt | Status |
|--------|--------|
| Platform format (`"platforms"` array) | ✅ |
| `"platform": "XiaomiMiAirPurifier"` matches pluginAlias | ✅ |
| `devices` array structure | ✅ |
| Token format (32 hex) | ✅ |
| Model string (valid enum) | ✅ |

---

## 8. Lista krytycznych problemów (blokery publikacji na npm)

**Brak krytycznych blokerów. Projekt jest gotowy do publikacji na npm.**

---

## 9. Lista usprawnień (priorytetyzowana)

### HIGH priority

Brak — wszystkie critical i high issues rozwiązane.

### MEDIUM priority

Brak.

### LOW priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| L1 | Redukcja type casts w kodzie produkcyjnym | Rozważyć runtime type guards zamiast `as never` w `getOrAddService`, `bindOnGet`, `updateCharacteristicIfNeeded`. Kompatybilność HB 1.x/2.x wymusza kompromisy. |

### INFO (obserwacje, nie wymagają akcji)

| # | Obserwacja |
|---|-----------|
| I1 | `motor1_speed`, `use_time`, `purify_volume` czytane z urządzenia ale nie eksponowane w HomeKit. Informacje diagnostyczne w state — poprawne. |
| I2 | Static IV w AES-128-CBC — ograniczenie protokołu MIIO, nie kodu. |
| I3 | `DEFAULT_RETRY_POLICY.maxDelayMs` (30s) nadpisywane przez `reconnectDelayMs` config (15s default). Spójne. |
| I4 | Semantic-release plugins version-pinned ale nie integrity-pinned. Standardowa praktyka. |
| I5 | `@types/node` pinned do `^22.0.0` (current: 22.19.15, latest: 25.x). Poprawne dla `engines.node`. |
| I6 | `q@1.1.2` (deprecated) — jedyna deprecated zależność, transitive via `homebridge@1.11.2 → hap-nodejs → node-persist`. Akceptowalne. |
| I7 | Entry point verified: `require('./dist/index.js')` returns object with `default` function — correct CommonJS export. |

---

## 10. Ocena zgodności ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja i aliasy | 10/10 | `registerPlatform` + matching pluginAlias + `singular: true` |
| Lifecycle (init/shutdown) | 10/10 | Non-blocking init, proper shutdown handler, `configureAccessory` |
| Error handling i resilience | 10/10 | Queue isolation, retry with backoff, connection events |
| Config validation | 10/10 | Trójstronna spójność README/schema/code |
| Config schema / UI layout | 10/10 | 3 logiczne sekcje z expandable, `required` fields |
| HomeKit mapping accuracy | 10/10 | Wszystkie characteristics poprawne, w tym IDLE, ConfiguredName |
| Reconnect stability | 10/10 | 9 scenariuszy testowych (S1-S9) |
| Version compatibility (1.x/2.x) | 10/10 | Dynamic detection, CI matrix, enum fallbacks |
| Stale accessory management | 10/10 | UUID tracking + `unregisterPlatformAccessories` |
| **Łączna ocena** | **10/10** | |

---

## 11. Checklista „gotowe do npm"

### Metadata

| Element | Status |
|---------|--------|
| `name` (unique, scoped) | ✅ `homebridge-xiaomi-air-purifier-modern` |
| `version` | ✅ `1.0.0` |
| `description` | ✅ |
| `main` / `types` | ✅ `dist/index.js` / `dist/index.d.ts` |
| `files` (whitelist) | ✅ `dist`, `config.schema.json`, docs (34 files in pack) |
| `keywords` (15, discoverable) | ✅ homebridge-plugin, homekit, xiaomi, miio, miot, etc. |
| `engines` (node + homebridge + npm) | ✅ |
| `peerDependencies` (homebridge) | ✅ |
| `homepage` / `repository` / `bugs` | ✅ |
| `license` (SPDX) | ✅ `MIT` |
| `author` | ✅ |
| `displayName` (Homebridge UI) | ✅ |
| `type` (module system) | ✅ `commonjs` |
| `prepublishOnly` (quality gates) | ✅ lint + typecheck + test + build |
| `config.schema.json` | ✅ pluginAlias, pluginType, singular, schema, layout |

### Dokumentacja

| Element | Status |
|---------|--------|
| LICENSE (MIT) | ✅ |
| README (install, config, troubleshooting, examples) | ✅ |
| CHANGELOG (populated, v1.0.0 + Unreleased) | ✅ |
| CONTRIBUTING | ✅ |
| CODE_OF_CONDUCT | ✅ |
| SECURITY.md (z SLA tablicą) | ✅ |
| Issue templates (bug + feature, YAML forms) | ✅ |
| PR template (with checklist) | ✅ |
| CODEOWNERS | ✅ |
| RELEASE_CHECKLIST | ✅ |

### Infrastruktura kodu

| Element | Status |
|---------|--------|
| tsconfig (strict + 4 advanced strict flags) | ✅ |
| tsconfig.test.json (extends base + vitest/globals) | ✅ |
| biome.json (recommended + noExplicitAny: error) | ✅ |
| vitest.config.ts (100% threshold all metrics) | ✅ |
| .editorconfig (UTF-8, LF, 2-space) | ✅ |
| .gitignore (node_modules, dist, coverage, *.tgz) | ✅ |
| .npmrc (engine-strict=true) | ✅ |
| .releaserc.json (6 plugins) | ✅ |
| package-lock.json (lockfileVersion 3) | ✅ |

### CI/CD

| Element | Status |
|---------|--------|
| CI matrix (Node 20/22/24 × HB 1.x/2.x, 5 configs) | ✅ |
| npm audit in CI (ci.yml + release.yml) | ✅ |
| Release (semantic-release + npm provenance) | ✅ |
| Supply chain (SBOM + OSV Scanner) | ✅ |
| OpenSSF Scorecard | ✅ |
| Dependabot (npm + Actions weekly) | ✅ |
| SHA-pinned Actions (9 unique, all pinned) | ✅ |
| Auto-labeling (5 categories) | ✅ |
| Stale issue management | ✅ |
| Concurrency control | ✅ |

### Build & Test (zweryfikowane uruchomieniem)

| Element | Status | Weryfikacja |
|---------|--------|-------------|
| lint (0 errors) | ✅ | "Checked 30 files in 56ms. No fixes applied." |
| typecheck (0 errors) | ✅ | `tsc --noEmit` — clean |
| test (126 tests, 100% coverage) | ✅ | 13 test files, 3.45s, all metrics 100% |
| build (tsc) | ✅ | Clean TypeScript compilation |
| npm audit | ✅ | "found 0 vulnerabilities" |
| npm pack | ✅ | 34 files, 37.2 kB packed, 163.7 kB unpacked |
| Zero runtime dependencies | ✅ | All deps are `devDependencies` or `peerDependencies` |
| Source maps in dist | ✅ | `*.js.map` included in pack |
| Declaration files in dist | ✅ | `*.d.ts` included in pack |
| npm outdated | ✅ | Only `@types/node` 22.x vs 25.x — correct for engines |
| Deprecated packages | ✅ | Only `q@1.1.2` (transitive: homebridge 1.x) |

---

## 12. Podsumowanie końcowe

**Projekt jest w pełni gotowy do publikacji na npm. Nie ma żadnych krytycznych problemów.**

| Metryka | Wartość |
|---------|---------|
| Linie kodu (src) | 2292 |
| Linie testów + helpers | 4732 |
| Test:Source ratio | ~2.1× |
| Pokrycie kodu | 100% (enforced, zweryfikowane uruchomieniem) |
| Runtime dependencies | **0** |
| Known vulnerabilities | **0** (npm audit clean) |
| Deprecated deps | 1 (q@1.1.2, homebridge 1.x transitive — akceptowane) |
| CI workflows | 6 |
| CI matrix configurations | 5 |
| Supported Node versions | 20, 22, 24 |
| Supported Homebridge | 1.11.1+ / 2.x |
| Supported purifier models | 5 |
| Protocols supported | MIOT + Legacy MIIO (auto-detect + fallback) |
| HomeKit services | 11 (6 conditional) |
| npm pack size | 37.2 kB |

### Oceny finalne

| Obszar | Ocena |
|--------|-------|
| Architektura i jakość kodu | 9.5/10 |
| Zgodność Homebridge 1.x/2.x | 10/10 |
| Testy i pokrycie | 10/10 |
| CI/CD i automatyzacja | 10/10 |
| Security & supply chain | 9.5/10 |
| Dokumentacja i OSS readiness | 10/10 |
| README vs kod spójność | 10/10 |
| **Ocena ogólna** | **9.9/10** |

Projekt reprezentuje bardzo wysoki standard jakości dla wtyczek Homebridge: zero runtime dependencies, 126 testów w 13 fokusowych plikach z wymuszonym 100% pokryciem kodu (zweryfikowane uruchomieniem w 3.45s), profesjonalny CI/CD z npm provenance i SBOM, pełna dokumentacja OSS z community standards, kompletna trójstronna spójność README ↔ config.schema.json ↔ kod. Jedyna sugestia to minor redukcja type casts (L1) — uzasadnionych kompatybilnością HB 1.x/2.x.

### Zmiany od v10 → v11

- **Zaktualizowano strukturę testów** — v10 referował stare pliki `accessory-platform-index.test.ts` (1437 LOC) i `miio-transport-coverage.test.ts` (1073 LOC), które zostały podzielone na 5 fokusowych modułów. Aktualnie: 13 plików testowych (zamiast 10).
- **Usunięto L1/L2** z listy usprawnień — podział dużych plików testowych został zrealizowany (commit `ce8506c`).
- **Zaktualizowano dane weryfikacyjne** — lint: 30 plików (nie 27), czas testów: 3.45s (nie 4.44s), LOC testów: 4732 (nie 4674).

---

*Raport v11 wygenerowany niezależnie. Wszystkie wyniki zweryfikowane uruchomieniem komend w środowisku Node.js v22 na Linux. Data: 2026-03-08.*
