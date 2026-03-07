# Homebridge Plugin Audit Report — v7

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-03-07
**Audytor:** Claude Opus 4.6 — pełny niezależny code review, security audit, quality assessment
**Metoda:** Każdy plik źródłowy, testowy, konfiguracyjny i dokumentacyjny w repozytorium przeczytany i przeanalizowany. Raport v6 zweryfikowany i zaktualizowany.

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka opiera się wyłącznie na `node:crypto` i `node:dgram`. Supply-chain risk praktycznie zerowy. To rzadkość wśród wtyczek Homebridge.

2. **~88 testów, 100% pokrycie kodu** — 9 plików testowych z progami wymuszanymi w `vitest.config.ts` (statements/branches/functions/lines = 100%). Obejmuje 9 realistycznych scenariuszy sieciowych (S1-S9).

3. **Profesjonalny CI/CD** — semantic-release z npm provenance, SBOM CycloneDX, OSV Scanner, OpenSSF Scorecard, Dependabot (npm + GitHub Actions), macierz CI na Node 20/22/24 × Homebridge 1.11.2/beta, SHA-pinned actions.

4. **Solidna architektura warstwowa** — `MiioTransport → DeviceClient → AirPurifierAccessory → XiaomiAirPurifierAccessoryPlugin`. Operation queue serializująca UDP, retry z exponential backoff + jitter, dual protocol (MIOT/Legacy) z auto-detekcją i fallback.

5. **Pełna spójność README ↔ config.schema.json ↔ kod** — trójstronna weryfikacja domyślnych wartości, limitów i mapowań HomeKit potwierdzona.

6. **Kompletna dokumentacja OSS** — README z pełną konfiguracją, troubleshooting, AQI mapping, network hardening. CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, CODEOWNERS.

### Główne ryzyka / obszary do poprawy

1. **Duplikacja infrastruktury testowej** — `FakeService`, `FakeCharacteristic`, `FakeClient`, `makeApi()` powielone między plikami testowymi (~200 LOC duplikacji). Nie blokuje publikacji, ale zwiększa koszt utrzymania.

2. **Nadmierne użycie `Reflect.get` i type casts w kodzie produkcyjnym** — używane do kompatybilności z HB 1.x/2.x (co jest uzasadnione), ale zwiększa complexity i utrudnia statyczną analizę.

3. **Brak testu crypto round-trip** — żaden test nie weryfikuje AES-128-CBC encrypt/decrypt end-to-end z known token/payload.

4. **Duże pliki testowe** — `miio-transport-coverage.test.ts` (~1000+ LOC) i `accessory-platform-index.test.ts` (~1250+ LOC) mogłyby być podzielone.

---

## 2. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/                            ~2100 LOC (7 plików)
│   ├── index.ts                    Entry point — registerAccessory (14 LOC)
│   ├── platform.ts                 Config validation, DI wiring (229 LOC)
│   ├── accessories/
│   │   └── air-purifier.ts         HomeKit service/characteristic binding (592 LOC)
│   └── core/
│       ├── device-client.ts        Polling, retry, operation queue (317 LOC)
│       ├── miio-transport.ts       MIIO/MIOT UDP protocol, crypto (775 LOC)
│       ├── mappers.ts              Fan level ↔ %, AQI → HomeKit (41 LOC)
│       ├── mode-policy.ts          Auto/Night switch logic (30 LOC)
│       ├── retry.ts                Backoff + retryable error codes (77 LOC)
│       └── types.ts                Shared types + property list (49 LOC)
├── test/                           ~3800+ LOC, ~88 tests
├── .github/
│   ├── workflows/                  5 workflows (ci, release, supply-chain, scorecard, stale, labeler)
│   ├── dependabot.yml, CODEOWNERS, labeler.yml
│   ├── ISSUE_TEMPLATE/             bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── docs/                           reliability-test-plan.md
├── config.schema.json              Homebridge UI schema + layout
├── biome.json / tsconfig.json / tsconfig.test.json / vitest.config.ts
├── .releaserc.json / .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
└── README.md / CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
    LICENSE / SECURITY.md / RELEASE_CHECKLIST.md
```

**Ocena struktury: 10/10.** Czysty podział na warstwy, SRP przestrzegane, brak "god objects". Każdy moduł ma jedną odpowiedzialność.

---

## 3. Zgodność ze standardami Homebridge 1.x i 2.x

### 3.1 Rejestracja i lifecycle

| Aspekt | Status | Dowód w kodzie |
|--------|--------|----------------|
| `registerAccessory` | ✅ | `index.ts:8-13` — `export =` z `(api: API) => void` |
| `pluginAlias` match | ✅ | `XiaomiMiAirPurifier` = `ACCESSORY_NAME` = `config.schema.json:pluginAlias` |
| `pluginType` | ✅ | `"accessory"` w `config.schema.json` |
| `displayName` | ✅ | `package.json:73` |
| Init (non-blocking) | ✅ | `air-purifier.ts:130-136` — `void client.init().then(...).catch(...)` |
| Shutdown | ✅ | `air-purifier.ts:138-143` — `api.on("shutdown", ...)` z `void client.shutdown().catch(...)` |
| Timer cleanup | ✅ | `device-client.ts:279-301` — `clearTimers()` czyści 4 timery + resolve pending delay |
| Timer unref | ✅ | Wszystkie timery `.unref()` — nie blokują graceful process exit |
| Socket cleanup | ✅ | `miio-transport.ts:277-304` — idempotent `close()` z `socketClosed` guard |
| Error isolation | ✅ | Shutdown, init, listener errors — wszystkie złapane i zalogowane |

### 3.2 Reconnect i retry

| Aspekt | Status | Dowód w kodzie |
|--------|--------|----------------|
| Exponential backoff | ✅ | `retry.ts:15-25` — base=400ms, cap=configurable, 8 retries, 20% jitter |
| 16 retryable error codes | ✅ | `retry.ts:27-45` — ETIMEDOUT, ECONNRESET, ENETDOWN, EHOSTUNREACH, EAI_AGAIN itd. |
| `EDEVICEUNAVAILABLE` reduced retries | ✅ | `retry.ts:47,62-76` — max 2 retries |
| Connection events | ✅ | `device-client.ts:217-224` — connected/disconnected/reconnected |
| Handshake retry | ✅ | `miio-transport.ts:593-603` — `call()` invaliduje session i re-handshake po transport error |
| Retry-during-shutdown | ✅ | `device-client.ts:198,264` — `destroyed` flag sprawdzany |
| Queue error isolation | ✅ | `device-client.ts:180-184` — rejected operacja nie blokuje kolejnych |

### 3.3 Mapowanie HomeKit characteristics

| Oczyszczacz → HomeKit | Status | Dowód |
|----------------------|--------|-------|
| Power ON/OFF | ✅ | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch:On` (HB 1.x) |
| CurrentAirPurifierState | ✅ | INACTIVE / IDLE / PURIFYING_AIR — 3 stany poprawnie mapowane |
| TargetAirPurifierState | ✅ | onGet + onSet: AUTO→"auto", MANUAL→"favorite" |
| RotationSpeed | ✅ | `mappers.ts:4-8,10-14` — fan level 1-16 ↔ 0-100% |
| AirQuality | ✅ | `mappers.ts:18-40` — 6 progów z UNKNOWN dla NaN/<0 |
| PM2.5 Density | ✅ | `air-purifier.ts:424` — clamped [0, 1000] |
| Temperature / Humidity | ✅ | Opcjonalne, domyślnie włączone |
| Filter Maintenance | ✅ | `FilterLifeLevel` + `FilterChangeIndication` z progiem |
| Filter Alert (Contact) | ✅ | Opcjonalny, `exposeFilterReplaceAlertSensor` |
| Child Lock | ✅ | Opcjonalny Switch |
| LED Night Mode | ✅ | Switch z `set_led`/`get_led` |
| Mode AUTO ON/OFF | ✅ | ON=auto, OFF=sleep; guard when power OFF |
| Mode NIGHT ON/OFF | ✅ | ON=sleep, OFF=auto; guard when power OFF |
| AccessoryInformation | ✅ | Manufacturer, Model, Name, SerialNumber |

### 3.4 Kompatybilność wersji

| Aspekt | Status |
|--------|--------|
| `engines.homebridge`: `^1.11.1 \|\| ^2.0.0` | ✅ |
| `peerDependencies` = `engines.homebridge` | ✅ |
| `engines.node`: `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` | ✅ |
| CI matrix: Node 20/22/24 × HB 1.11.2/beta | ✅ |
| Dynamic `AirPurifier` service detection via `Reflect.get` | ✅ |
| Dynamic `ConfiguredName` characteristic detection | ✅ |
| Enum fallbacks (numeric defaults for missing HAP constants) | ✅ |

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
| `noExplicitAny: error` (Biome) | ✅ |
| Target ES2022, module CommonJS | ✅ |
| Declaration files (`declaration: true`) | ✅ |
| Source maps | ✅ |

**Komentarz:** Najostrzejsze flagi TypeScript. `noUncheckedIndexedAccess` i `exactOptionalPropertyTypes` to rzadko włączane opcje — ich obecność świadczy o dbałości o null safety.

### 4.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | ✅ | Brak mieszania callbacks z promises |
| Operation queue (serializacja) | ✅ | `enqueueOperation` zapobiega race conditions na UDP socket |
| Queue error isolation | ✅ | Rejected operacja nie blokuje kolejnych |
| Fire-and-forget safety | ✅ | `void promise.catch(...)` — brak unhandled rejections |
| Listener error isolation | ✅ | try/catch wokół state i connection listener callbacks |
| Socket error handler | ✅ | `socket.on("error", ...)` — zapobiega process crash |
| Error typing | ✅ | Consistent `error instanceof Error ? error.message : String(error)` |

**Uwaga architektoniczna:** Operation queue pattern (`enqueueOperation`) jest dobrze zaprojektowany — używa chain promises z release resolve, zapewniając FIFO ordering i error isolation. Jedynym edge case'em jest sytuacja, gdy `init()` zostanie wywołany dwukrotnie równolegle — choć praktycznie nie powinno to wystąpić w kontekście Homebridge.

### 4.3 Zasoby i zarządzanie pamięcią

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | ✅ | Centralne `clearTimers()` + resolve pending delay promise |
| Socket cleanup | ✅ | Idempotent z `socketClosed` flag |
| Listener unsubscribe | ✅ | `onStateUpdate`/`onConnectionEvent` zwracają cleanup fn |
| `characteristicCache` bounded | ✅ | Stały zbiór ~20 characteristics — nie rośnie |
| `.unref()` na timerach | ✅ | Nie blokuje process exit |
| No event listener leaks | ✅ | `socket.off("message"/"error")` w `sendAndReceive` cleanup |
| MessageId overflow | ✅ | `(nextMessageId % 2_147_483_647) + 1` — wraps safely |

### 4.4 Protokół MIIO/MIOT — analiza implementacji

**Szyfrowanie (AES-128-CBC):**
```
key = MD5(token)
iv  = MD5(key || token)
```
Standard protokołu Xiaomi. Static IV to ograniczenie protokołu, nie kodu.

**Detekcja protokołu (MIOT vs Legacy):**
1. Próba `get_properties` z MIOT probe → sukces = MIOT
2. Fallback: `get_prop` z legacy → sukces = legacy
3. Oba fail → `null` → default `legacy`
4. Runtime fallback: jeśli MIOT error (non-retryable) → switch to legacy
5. Defensive: jeśli legacy zwraca all-empty core fields → retry MIOT once

**LED mapping — poprawne rozróżnienie MIOT vs Legacy:**

| Tryb | Właściwość | Wartości | Konwersja |
|------|-----------|---------|-----------|
| MIOT | `led` (siid:6, piid:1) | 0=bright, 1=dim, 2=off | `toNumber(v) !== 2` |
| Legacy | `led` ("on"/"off") | string | `toBoolean(v)` |
| Legacy | `led_b` (fallback) | 0=bright, 1=dim, 2=off | `toLegacyLed(v)` |

**MIOT batch optimization:**
Jedna komenda `get_properties` z ~20 parametrami. Fallback na per-property reads jeśli batch nieobsługiwany.

**Set fan level (MIOT):**
Atomowe ustawienie mode=favorite + fan_level w jednym batch `set_properties`. Poprawne — udokumentowane w README.

### 4.5 Logowanie

| Aspekt | Status |
|--------|--------|
| Token nigdy nie logowany | ✅ — zweryfikowane: żaden `log.*` call nie zawiera `token` |
| Address masking (`maskDeviceAddressInLogs`) | ✅ |
| SerialNumber używa `displayAddress` | ✅ |
| Poziomy: debug/info/warn/error | ✅ — poprawne użycie |
| Suppressed errors: `process.emitWarning` z context tagiem | ✅ |
| Connection lifecycle events logowane | ✅ |

### 4.6 Styl kodu

| Aspekt | Status |
|--------|--------|
| Biome linter (recommended + `noExplicitAny: error`) | ✅ |
| Biome formatter (space indent, 2-space) | ✅ |
| EditorConfig (UTF-8, LF, 2-space) | ✅ |
| Consistent naming conventions | ✅ |
| No magic numbers (constants/config) | ✅ |
| No dead code/imports | ✅ |

**Ocena jakości kodu: 9.5/10** — drobne zastrzeżenia dot. `Reflect.get` overuse i `as never` casts (uzasadnione kompatybilnością HB 1.x/2.x).

---

## 5. Security & Supply Chain

### 5.1 Wrażliwe dane

| Aspekt | Status | Dowód |
|--------|--------|-------|
| Token w logach | ✅ Nigdy | Żaden `log` call nie zawiera `token` |
| Token w `error.message` | ✅ Nigdy | Komunikaty błędów nie zawierają tokenu |
| Token walidacja | ✅ | `platform.ts:63` — regex `^[0-9a-fA-F]{32}$` + `config.schema.json` pattern |
| IP masking | ✅ | `platform.ts:45-52` — `maskAddress()` + `displayAddress` propagacja |
| SerialNumber masking | ✅ | `air-purifier.ts:555-557` — `buildSerialNumber(displayAddress)` |

### 5.2 Protokół sieciowy

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| AES-128-CBC szyfrowanie | ✅ | Standard MIIO |
| Static IV | ℹ️ | Ograniczenie protokołu Xiaomi, nie kodu |
| Message ID filtering | ✅ | `sendAndReceive` filtruje response po ID (bytes 4-7) |
| MIIO magic validation | ✅ | Sprawdzenie `0x2131` + response length ≥ 32 |
| WAN exposure | ✅ Brak | Tylko LAN UDP 54321 |
| README network hardening | ✅ | VLAN, ACL, egress blocking rekomendowane |
| No command injection | ✅ | `JSON.stringify` z typami, brak string interpolacji w komendach |
| Checksum verification | ⚠️ Brak | Response checksum z nagłówka nie jest weryfikowany. Dla LAN-only UDP z szyfrowanym payloadem to akceptowalne, ale nie idealne |

### 5.3 Dependencies & Supply Chain

| Aspekt | Status |
|--------|--------|
| **Runtime dependencies: 0** | ✅ |
| `package-lock.json` lockfileVersion 3 | ✅ |
| `engine-strict=true` w `.npmrc` | ✅ |
| Dependabot (npm weekly + Actions weekly) | ✅ |
| SHA-pinned GitHub Actions | ✅ (wszystkie actions pinned do commit SHA) |
| SBOM CycloneDX | ✅ |
| OSV Scanner | ✅ |
| OpenSSF Scorecard | ✅ |
| npm provenance (`NPM_CONFIG_PROVENANCE: true`) | ✅ |
| PoLP workflow permissions | ✅ (`contents: read` default, minimal escalations) |
| `files` w package.json (whitelist) | ✅ |
| No secrets in code | ✅ |

### 5.4 CI Security

| Aspekt | Status |
|--------|--------|
| Concurrency with cancel-in-progress | ✅ |
| `npm audit --audit-level=high` w CI | ✅ (ci.yml + release.yml) |
| Pre-release gates: audit → check → release | ✅ |
| `fetch-depth: 0` only in release (needed for semantic-release) | ✅ |
| `persist-credentials: false` w scorecard | ✅ |
| Minimal `id-token: write` only for provenance | ✅ |

### 5.5 Release workflow — supply chain note

Semantic-release plugins w `release.yml` są version-pinned (np. `@semantic-release/changelog@6.0.3`) ale nie integrity-pinned (brak hash). Instalowane w runtime przez `cycjimmy/semantic-release-action`. To standardowa praktyka, ale warto mieć świadomość, że compromised npm package mógłby wpłynąć na release. Ryzyko niskie ze względu na npm provenance i audit gate.

**Ocena security: 9.5/10** — brak krytycznych problemów; noty o brakującej weryfikacji checksum response i release plugin pinning.

---

## 6. Testy i CI/CD

### 6.1 Testy

| Metryka | Wartość |
|---------|---------|
| Framework | vitest v4 |
| Coverage provider | v8 |
| Testy | ~88 (100% pass) |
| Pliki testowe | 9 |
| Pokrycie statements | 100% (enforced) |
| Pokrycie branches | 100% (enforced) |
| Pokrycie functions | 100% (enforced) |
| Pokrycie lines | 100% (enforced) |

**Kategorie testów:**

| Plik | Testów | Pokrywa |
|------|--------|---------|
| `accessory-platform-index.test.ts` | ~14 | Accessory services, config validation, lifecycle, HomeKit bindings |
| `device-api.test.ts` | 7 | Read/write API contract, parameter encoding, queue serialization, set-and-sync |
| `device-client-branches.test.ts` | 20 | Queue, retry, listeners, timers, error isolation, EDEVICEUNAVAILABLE cap |
| `mappers.test.ts` | 4 | Fan level mapping, AQI thresholds |
| `miio-transport-coverage.test.ts` | ~17 | Protocol, handshake, crypto, error paths, batch reads |
| `miio-transport-reliability.test.ts` | 8 | Retryable error handling, close idempotency, diagnostics |
| `mode-policy.test.ts` | 4 | Auto/Night switch state machine |
| `network-scenarios.test.ts` | 9 | S1-S9: realistic network failure/recovery + filter lifecycle |
| `reliability.test.ts` | 5 | Backoff computation, error classification, socket error |

**Mocne strony testów:**
- DI-based mocking (interfejsy `MiioTransport`, `Logger`) — clean architecture
- `ScriptedTransport` z queue-based reads — deterministic sequencing
- `FakeSocket` dla UDP layer — brak potrzeby rzeczywistego socketa
- `vi.useFakeTimers()` z kontrolowanym time-advancement
- 9 realistycznych scenariuszy sieciowych (restart urządzenia, router, packet loss, Wi-Fi outage, filter lifecycle)
- Isolation testów: proper cleanup w `afterEach`
- Retryable error cycle test z 16 kodami błędów

**Uwagi do testów (nie blokujące):**

| # | Uwaga | Priorytet |
|---|-------|-----------|
| T1 | Duplikacja `FakeService`, `FakeCharacteristic`, `makeApi()` między `network-scenarios.test.ts` i `accessory-platform-index.test.ts` (~200 LOC). Ekstrakcja do `test/helpers/` zmniejszyłaby maintenance burden. | Medium |
| T2 | `miio-transport-coverage.test.ts` (~1000+ LOC) pokrywa wiele odrębnych concerns. Podział na 3-4 pliki poprawiłby czytelność. | Low |
| T3 | `accessory-platform-index.test.ts` (~1250+ LOC) łączy accessory behavior, config validation i index registration. | Low |
| T4 | Nadmierne użycie `as never` i `as unknown as` type casts w testach (konieczne dla branch coverage prywatnych metod, ale kruche). | Low |
| T5 | Brak testu crypto round-trip (encrypt → decrypt z known token/payload). | Low |
| T6 | Brak testu dla concurrent `init()` calls. | Low |
| T7 | Brak testów boundary values dla `rotationSpeedToFanLevel` (np. negatywne, >100, non-integer). | Low |

### 6.2 CI Pipeline

| Workflow | Trigger | Opis |
|----------|---------|------|
| `ci.yml` | push main + PR | 5 configs matrix, lint + typecheck + test + coverage + audit |
| `release.yml` | push main | audit → check → semantic-release → npm publish |
| `supply-chain.yml` | push main + PR | SBOM CycloneDX + OSV Scanner |
| `scorecard.yml` | push main + weekly cron | OpenSSF Scorecard → SARIF → CodeQL |
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

**Uwaga o build step:** `npm ci` uruchamia `prepare` → `npm run build`, więc TypeScript build jest wykonywany. Następnie `npm install --no-save homebridge@${{ matrix.homebridge }}` instaluje docelową wersję HB, a `typecheck` weryfikuje typy. Poprawna kolejność.

### 6.3 Release Pipeline

| Aspekt | Status |
|--------|--------|
| semantic-release v24 | ✅ |
| Conventional commits | ✅ (wymagane przez `commit-analyzer`) |
| Auto-generated changelog | ✅ (`@semantic-release/changelog`) |
| Git tag + GitHub release | ✅ |
| npm publish z provenance | ✅ |
| Pre-release gates | ✅ (`npm audit` + `npm run check`) |
| `check` = lint + typecheck + test + build | ✅ |
| `prepublishOnly` = lint + typecheck + test + build | ✅ |

**Ocena CI/CD: 10/10**

---

## 7. Weryfikacja README vs Kod (trójstronna)

### 7.1 Pola konfiguracji — domyślne wartości i limity

| Pole | README | config.schema.json | platform.ts | Status |
|------|--------|-------------------|-------------|--------|
| `enableAirQuality` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableTemperature` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableHumidity` | default true | `"default": true` | `normalizeBoolean(…, true)` | ✅ |
| `enableChildLockControl` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |
| `filterChangeThreshold` | default 10, [0,100] | `"default": 10, min 0, max 100` | `normalizeThreshold` (10, clamp) | ✅ |
| `exposeFilterReplaceAlertSensor` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |
| `connectTimeoutMs` | 15000, min 100 | `"default": 15000, min 100` | `normalizeTimeout(…, 15_000)` min=100 | ✅ |
| `operationTimeoutMs` | 15000, min 100 | `"default": 15000, min 100` | `normalizeTimeout(…, 15_000)` min=100 | ✅ |
| `reconnectDelayMs` | 15000 (max cap) | `"default": 15000, min 100` | `maxDelayMs: reconnectDelayMs` | ✅ |
| `keepAliveIntervalMs` | 60000, min 1000 | `"default": 60000, min 1000` | `normalizeTimeout(…, 60_000, 1_000)` | ✅ |
| `operationPollIntervalMs` | 10000, min 1000 | `"default": 10000, min 1000` | `normalizeTimeout(…, 10_000, 1_000)` | ✅ |
| `sensorPollIntervalMs` | 30000, min 1000 | `"default": 30000, min 1000` | `normalizeTimeout(…, 30_000, 1_000)` | ✅ |
| `maskDeviceAddressInLogs` | default false | `"default": false` | `normalizeBoolean(…, false)` | ✅ |

**Pełna trójstronna spójność: README ↔ config.schema.json ↔ platform.ts.** ✅

### 7.2 AQI mapping — README vs kod

| README | Implementacja (`mappers.ts`) | Status |
|--------|-----|--------|
| AQI < 0 / NaN = UNKNOWN (0) | `!isFinite \|\| <0 → 0` (line 19) | ✅ |
| AQI ≤35 = Excellent (1) | `aqi <= 35 → 1` (line 23) | ✅ |
| AQI 36-75 = Good (2) | `aqi <= 75 → 2` (line 27) | ✅ |
| AQI 76-115 = Fair (3) | `aqi <= 115 → 3` (line 31) | ✅ |
| AQI 116-150 = Poor (4) | `aqi <= 150 → 4` (line 35) | ✅ |
| AQI >150 = Inferior (5) | `return 5` (line 39) | ✅ |
| PM2.5 = raw AQI [0, 1000] | `Math.min(1000, Math.max(0, state.aqi))` | ✅ |
| PM2.5 is AQI not µg/m³ | README line 155 — nota | ✅ |

### 7.3 Supported models — trójstronna

| Źródło | Modele | Spójne? |
|--------|--------|---------|
| README | 2h, 3, 3h, 4, pro | ✅ |
| `config.schema.json` enum | 2h, 3, 3h, 4, pro | ✅ |
| `platform.ts` SUPPORTED_MODELS | 2h, 3, 3h, 4, pro | ✅ |

---

## 8. Lista krytycznych problemów (blokery publikacji na npm)

**Brak krytycznych blokerów. Projekt jest gotowy do publikacji na npm.**

---

## 9. Lista usprawnień (priorytetyzowana)

### HIGH priority

Brak — wszystkie critical i high issues rozwiązane.

### MEDIUM priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| M1 | Wyodrębnienie shared test fixtures (`test/helpers/`) | ~200 LOC duplikacji `FakeService`/`FakeCharacteristic`/`makeApi()` między plikami testowymi. Zmniejszyłoby maintenance burden i ryzyko rozbieżności między kopiami. |

### LOW priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| L1 | Podział `miio-transport-coverage.test.ts` i `accessory-platform-index.test.ts` | Oba pliki >1000 LOC. Podział na mniejsze pliki poprawiłby czytelność. |
| L2 | Test crypto round-trip | Weryfikacja encrypt/decrypt z known token/payload jako unit test. Obecnie crypto jest testowane pośrednio. |
| L3 | Weryfikacja checksum w response MIIO | Nagłówek MIIO zawiera checksum MD5, ale response checksum nie jest weryfikowany. Dodanie weryfikacji poprawiłoby odporność na corrupt packets. |
| L4 | Redukcja `Reflect.get` w kodzie produkcyjnym | Rozważyć runtime type guards z explicit fallback zamiast generycznego `Reflect.get` (np. dla `AirPurifier` service). |
| L5 | Platform plugin migration (v2.0) | Multi-device support, auto-discovery. Obecny model `accessory` z child bridge jest w pełni funkcjonalny — to long-term goal. |

### INFO (obserwacje, nie wymagają akcji)

| # | Obserwacja |
|---|-----------|
| I1 | `motor1_speed`, `use_time`, `purify_volume` czytane z urządzenia ale nie eksponowane w HomeKit. Informacje diagnostyczne w state — poprawne. |
| I2 | Static IV w AES-128-CBC — ograniczenie protokołu MIIO, nie kodu. |
| I3 | `DEFAULT_RETRY_POLICY.maxDelayMs` (30s) nadpisywane przez `reconnectDelayMs` config (15s default). Spójne. |
| I4 | Semantic-release plugins version-pinned ale nie integrity-pinned. Standardowa praktyka. |
| I5 | `env -u npm_config_http_proxy -u npm_config_https_proxy` w README i CI — specyficzne dla środowiska z proxy. Nie wpływa na funkcjonalność. |

---

## 10. Ocena zgodności ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja i aliasy | 10/10 | `registerAccessory` + matching pluginAlias |
| Lifecycle (init/shutdown) | 10/10 | Non-blocking init, proper shutdown handler |
| Error handling i resilience | 10/10 | Queue isolation, retry with backoff, connection events |
| Config validation | 10/10 | Trójstronna spójność README/schema/code |
| Config schema / UI layout | 10/10 | 3 logiczne sekcje z expandable |
| HomeKit mapping accuracy | 10/10 | Wszystkie characteristics poprawne, w tym IDLE |
| Reconnect stability | 10/10 | 9 scenariuszy testowych (S1-S9) |
| Version compatibility (1.x/2.x) | 10/10 | Dynamic detection, CI matrix, enum fallbacks |
| **Łączna ocena** | **10/10** | |

---

## 11. Checklista „gotowe do npm"

### Metadata

| Element | Status |
|---------|--------|
| `name` (unique) | ✅ `homebridge-xiaomi-air-purifier-modern` |
| `version` | ✅ `1.0.0` |
| `description` | ✅ |
| `main` / `types` | ✅ `dist/index.js` / `dist/index.d.ts` |
| `files` (whitelist) | ✅ `dist`, `config.schema.json`, docs |
| `keywords` (15, discoverable) | ✅ |
| `engines` (node + homebridge + npm) | ✅ |
| `peerDependencies` (homebridge) | ✅ |
| `homepage` / `repository` / `bugs` | ✅ |
| `license` (SPDX) | ✅ `MIT` |
| `author` | ✅ |
| `displayName` (Homebridge UI) | ✅ |
| `type` (module system) | ✅ `commonjs` |
| `prepublishOnly` (gates) | ✅ lint + typecheck + test + build |
| `config.schema.json` | ✅ pluginAlias, pluginType, schema, layout |

### Dokumentacja

| Element | Status |
|---------|--------|
| LICENSE (MIT) | ✅ |
| README (install, config, troubleshooting) | ✅ |
| CHANGELOG (populated) | ✅ |
| CONTRIBUTING | ✅ |
| CODE_OF_CONDUCT | ✅ |
| SECURITY.md (z SLA) | ✅ |
| Issue templates (bug + feature) | ✅ |
| PR template | ✅ |
| CODEOWNERS | ✅ |
| RELEASE_CHECKLIST | ✅ |

### Infrastruktura kodu

| Element | Status |
|---------|--------|
| tsconfig (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes) | ✅ |
| tsconfig.test.json (extends base + vitest/globals) | ✅ |
| biome.json (recommended + noExplicitAny: error) | ✅ |
| vitest.config.ts (100% threshold, v8 provider) | ✅ |
| .editorconfig (UTF-8, LF, 2-space) | ✅ |
| .gitignore (node_modules, dist, coverage, *.tgz) | ✅ |
| .npmrc (engine-strict=true) | ✅ |
| .releaserc.json (6 plugins) | ✅ |
| package-lock.json (lockfileVersion 3) | ✅ |

### CI/CD

| Element | Status |
|---------|--------|
| CI matrix (Node 20/22/24 × HB 1.x/2.x) | ✅ |
| npm audit in CI | ✅ |
| Release (semantic-release + npm provenance) | ✅ |
| Supply chain (SBOM + OSV Scanner) | ✅ |
| OpenSSF Scorecard | ✅ |
| Dependabot (npm + Actions weekly) | ✅ |
| SHA-pinned Actions | ✅ |
| Auto-labeling | ✅ |
| Stale issue management | ✅ |
| Concurrency control | ✅ |

### Build & Test

| Element | Status |
|---------|--------|
| lint (0 errors) | ✅ |
| typecheck (0 errors) | ✅ |
| test (~88 tests, 100% coverage) | ✅ |
| build (tsc) | ✅ |
| Zero runtime dependencies | ✅ |
| Source maps w dist | ✅ |
| Declaration files w dist | ✅ |

---

## 12. Podsumowanie końcowe

**Projekt jest w pełni gotowy do publikacji na npm. Nie ma żadnych krytycznych problemów.**

| Metryka | Wartość |
|---------|---------|
| Linie kodu (src) | ~2100 |
| Linie testów | ~3800+ |
| Test:Source ratio | ~1.8× |
| Pokrycie kodu | 100% (enforced) |
| Runtime dependencies | **0** |
| Known vulnerabilities | **0** |
| CI configurations | 6 workflows, 5 matrix nodes |
| Supported Node versions | 20, 22, 24 |
| Supported Homebridge | 1.11.1+ / 2.x |
| Supported purifier models | 5 |
| Protocols supported | MIOT + Legacy MIIO (auto-detect) |
| HomeKit services | 11 (6 conditional) |

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

Projekt reprezentuje bardzo wysoki standard jakości dla wtyczek Homebridge: zero runtime dependencies, 100% pokrycie testami, profesjonalny CI/CD z provenance i SBOM, pełna dokumentacja OSS, i pełna spójność między dokumentacją a kodem. Jedyne sugestie to drobne usprawnienia testów (M1: shared fixtures) i minor hardening (L3: response checksum).
