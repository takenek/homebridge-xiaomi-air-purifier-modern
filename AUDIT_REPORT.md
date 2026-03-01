# Homebridge Plugin Audit Report — v5 (Independent)

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-03-01
**Audytor:** Claude Opus 4.6 — pełny niezależny code review, security audit, README-vs-kod weryfikacja
**Metoda:** Każdy plik w repozytorium przeczytany i przeanalizowany ręcznie. Wszystkie narzędzia uruchomione (`npm test`, `npm run lint`, `npm run typecheck`, `npm audit`, `npm pack --dry-run`). Poprzedni raport (v4) zweryfikowany linia po linii vs aktualny kod.

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka opiera się wyłącznie na `node:crypto` i `node:dgram`. Supply-chain risk praktycznie zerowy. To najlepszy możliwy wynik dla pluginu Homebridge.

2. **100% pokrycie kodu testami** — 84 testy w 9 plikach, pokrycie wymuszane progami (statements/branches/functions/lines = 100%) w `vitest.config.ts`. Test:source ratio ~1.78×. Zawiera 7 dedykowanych scenariuszy sieciowych (restart urządzenia, router, packet loss, Wi-Fi outage).

3. **Profesjonalny CI/CD** — semantic-release z npm provenance, SBOM CycloneDX, OSV Scanner, OpenSSF Scorecard, Dependabot (npm + GitHub Actions), macierz CI na Node 20/22/24 × Homebridge 1.11.2/beta, SHA-pinned actions, PoLP permissions.

4. **Solidna architektura warstwowa** — `MiioTransport → DeviceClient → AirPurifierAccessory → XiaomiAirPurifierAccessoryPlugin`. Operation queue serializująca UDP, retry z exponential backoff + jitter, MIOT batch reads z fallback na per-property.

5. **Kompletna dokumentacja OSS** — README z pełną konfiguracją, troubleshooting, AQI mapping, network hardening. CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, CODEOWNERS, RELEASE_CHECKLIST.

6. **Pełna kompatybilność Homebridge 1.x / 2.x** — dynamiczna detekcja `AirPurifier` service z fallback na `Switch`, opcjonalne `ConfiguredName`, CI matrix testuje obie wersje.

### Ryzyka / uwagi (żadne nie blokują publikacji)

1. **PM2.5 Density vs AQI** — `PM2_5Density` characteristic otrzymuje wartość AQI z urządzenia, nie surowe µg/m³. To standardowa praktyka w Homebridge plugins (AQI ≈ PM2.5 w zakresie normal), ale warto to wyjaśnić w README.

2. **`setBuzzerVolume()` jest martwy z perspektywy HomeKit** — metoda jest zaimplementowana w `DeviceClient` i testowana, ale żaden HomeKit service jej nie używa. Nie jest to bug — to przygotowanie pod przyszłą funkcjonalność.

3. **Stały AUDIT_REPORT.md** — Istniejący raport v4 zawiera kilka stale findings (flaguje problemy które są już naprawione w kodzie). Szczegóły w sekcji 2.

---

## 2. Weryfikacja poprzedniego audytu (v4) — korekta stale findings

Poprzedni raport (v4) zawiera kilka ustaleń oznaczonych jako "do naprawy", które w aktualnym kodzie **są już naprawione**:

| ID v4 | Opis | Claim v4 | Stan faktyczny | Dowód w kodzie |
|--------|------|----------|---------------|----------------|
| H1 | `CurrentAirPurifierState.IDLE` | "Niezaimplementowane" | **Zaimplementowane** | `air-purifier.ts:392-396` — `state.mode === "idle" ? IDLE : PURIFYING_AIR` |
| M1 | Legacy LED `led_b` numeric fix | "toBoolean(0)=false → bug" | **Naprawione** | `miio-transport.ts:77-81` — dedykowana `toLegacyLed()` z `value !== 2` |
| M2 | "13 parallel UDP calls" | "readViaLegacyBatch robi 13 parallel" | **Nieprawda** | `miio-transport.ts:485-488` — 1 single `get_prop` call z batched params |
| M3 | OpenSSF Scorecard brakuje | "Do dodania" | **Istnieje** | `.github/workflows/scorecard.yml` z SHA-pinned `ossf/scorecard-action` |
| M4 | Auto-label brakuje | "Do dodania" | **Istnieje** | `.github/workflows/labeler.yml` + `.github/labeler.yml` z 5 kategoriami |
| L1 | Layout `config.schema.json` | "Sensors & Alerts razem z timing" | **Już rozdzielone** | `config.schema.json:148-209` — osobne sekcje "Sensors", "Alerts & Controls", "Privacy & Timing" |

**Wniosek:** Wszystkie findings z raportu v4 oznaczone jako "otwarte" są w rzeczywistości rozwiązane. Istniejący `AUDIT_REPORT.md` wymaga aktualizacji.

---

## 3. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/                            ~2100 LOC
│   ├── index.ts                    Entry point — registerAccessory (14 LOC)
│   ├── platform.ts                 Config validation, DI wiring (228 LOC)
│   ├── accessories/
│   │   └── air-purifier.ts         HomeKit service/characteristic binding (589 LOC)
│   └── core/
│       ├── device-client.ts        Polling, retry, operation queue (317 LOC)
│       ├── miio-transport.ts       MIIO/MIOT UDP protocol, crypto (781 LOC)
│       ├── mappers.ts              Fan level ↔ %, AQI → HomeKit (41 LOC)
│       ├── mode-policy.ts          Auto/Night switch logic (30 LOC)
│       ├── retry.ts                Backoff + retryable error codes (59 LOC)
│       └── types.ts                Shared types + property list (49 LOC)
├── test/                           ~3700 LOC, 84 tests
│   ├── accessory-platform-index    Accessory lifecycle, services, config validation
│   ├── device-api                  Read/write API contract
│   ├── device-client-branches      Queue, retry, listener, timer edge cases
│   ├── mappers                     Fan level + AQI mapping
│   ├── miio-transport-coverage     Protocol, handshake, crypto, error paths
│   ├── miio-transport-reliability  Retryable errors, close idempotency
│   ├── mode-policy                 Auto/Night switch state machine
│   ├── network-scenarios           7 realistic network failure scenarios
│   └── reliability                 Backoff computation, error classification
├── .github/
│   ├── workflows/                  ci.yml, release.yml, supply-chain.yml, scorecard.yml, labeler.yml
│   ├── dependabot.yml              npm + GitHub Actions weekly
│   ├── CODEOWNERS                  * @takenek
│   ├── ISSUE_TEMPLATE/             bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── config.schema.json              Homebridge UI schema + layout (211 LOC)
├── biome.json / tsconfig.json / tsconfig.test.json / vitest.config.ts
├── .releaserc.json / .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
└── README.md / CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
    LICENSE / SECURITY.md / RELEASE_CHECKLIST.md / AUDIT_REPORT.md
```

**Ocena struktury: Doskonała (10/10).** Czysty podział na warstwy, SRP przestrzegane, brak "god objects". Każdy moduł ma jedną odpowiedzialność.

---

## 4. Zgodność ze standardami Homebridge 1.x i 2.x

### 4.1 Rejestracja i lifecycle

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `registerAccessory` | ✅ | Poprawne `export =` z `(api: API) => void` w `index.ts` |
| `pluginAlias` match | ✅ | `XiaomiMiAirPurifier` = `ACCESSORY_NAME` = `config.schema.json:pluginAlias` |
| `pluginType` | ✅ | `"accessory"` — nie `"platform"` |
| `displayName` | ✅ | `package.json:73` — wymagane przez Homebridge UI |
| Init (non-blocking) | ✅ | `void client.init().then(...).catch(...)` — nie blokuje konstruktora |
| Shutdown | ✅ | `api.on("shutdown", ...)` z `void client.shutdown().catch(...)` |
| Timer cleanup | ✅ | `clearTimers()` czyści 4 timery (operation, sensor, keepalive, retry) + resolve pending delay |
| Timer unref | ✅ | Wszystkie timery `.unref()` — nie blokują graceful process exit |
| Socket cleanup | ✅ | Idempotent `close()` z `socketClosed` guard + `ERR_SOCKET_DGRAM_NOT_RUNNING` catch |
| Error isolation | ✅ | Shutdown errors, init errors, listener errors — wszystkie catch'd i log'd |

### 4.2 Reconnect i retry

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Exponential backoff | ✅ | base=400ms, cap=15s (configurable via `reconnectDelayMs`), 8 retries, 20% jitter |
| 16 retryable error codes | ✅ | ETIMEDOUT, ECONNRESET, ENETDOWN, EHOSTUNREACH, EAI_AGAIN, ERR_NETWORK_CHANGED, etc. |
| Connection events | ✅ | `connected`/`disconnected`/`reconnected` z logowaniem |
| Handshake retry | ✅ | `call()` invaliduje session i re-handshake po transport error |
| Session invalidation | ✅ | `this.session = null` po transport error w `call()` |
| No timer leaks | ✅ | Test [S5]: `getTimerCount() === 0` po shutdown |
| Retry-during-shutdown | ✅ | `destroyed` flag sprawdzany w `pollWithRetry` loop i `delay` |
| Queue error isolation | ✅ | Rejected operation nie blokuje kolejnych — `logSuppressedQueueError` + `catch` |

### 4.3 Mapowanie HomeKit characteristics

| Oczyszczacz → HomeKit | Status | Komentarz |
|----------------------|--------|-----------|
| Power ON/OFF | ✅ | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch:On` (HB 1.x) |
| CurrentAirPurifierState | ✅ | `INACTIVE` (power off), `IDLE` (mode=idle), `PURIFYING_AIR` (inne) |
| TargetAirPurifierState | ✅ | onGet + onSet: AUTO→"auto", MANUAL→"favorite" |
| RotationSpeed | ✅ | Fan level 1–16 ↔ 0–100% z poprawnym round-trip mapping |
| AirQuality | ✅ | ≤35=Excellent, ≤75=Good, ≤115=Fair, ≤150=Poor, >150=Inferior |
| PM2.5 Density | ✅ | Raw AQI clamped [0, 1000] — patrz uwaga w sekcji 10.1 |
| Temperature / Humidity | ✅ | Opcjonalne sensory z `normalizeBoolean(config, true)` |
| Filter Maintenance | ✅ | `FilterLifeLevel` + `FilterChangeIndication` z konfigurowalnym progiem |
| Filter Alert (Contact) | ✅ | Opcjonalny `ContactSensor` (`exposeFilterReplaceAlertSensor`, default false) |
| Child Lock | ✅ | Opcjonalny Switch (`enableChildLockControl`, default false) |
| LED Night Mode | ✅ | Switch z `set_led`/`get_led` |
| Mode AUTO ON/OFF | ✅ | Switch: ON=auto, OFF=sleep; guard: no-op when power OFF |
| Mode NIGHT ON/OFF | ✅ | Switch: ON=sleep, OFF=auto; guard: no-op when power OFF |
| AccessoryInformation | ✅ | Manufacturer=Xiaomi, Model=config, SerialNumber z `displayAddress` |

### 4.4 Kompatybilność wersji

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

## 5. Jakość kodu (Node.js / TypeScript)

### 5.1 Typowanie

| Aspekt | Status |
|--------|--------|
| `strict: true` + `noImplicitAny` | ✅ |
| `noUnusedLocals` + `noUnusedParameters` | ✅ |
| `noUncheckedIndexedAccess` | ✅ (rzadkie nawet w profesjonalnych projektach) |
| `exactOptionalPropertyTypes` | ✅ (najsurowsze ustawienie TS) |
| `noExplicitAny: error` (Biome) | ✅ |
| Target ES2022, module CommonJS | ✅ (optymalnie dla Node 20+) |
| Declaration files (`declaration: true`) | ✅ |
| Source maps | ✅ |

### 5.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | ✅ | Brak mieszania callbacks z promises |
| Operation queue (serializacja) | ✅ | `enqueueOperation` zapobiega race conditions na UDP |
| Queue error isolation | ✅ | Rejected operacja nie blokuje kolejnych |
| Fire-and-forget safety | ✅ | `void promise.catch(...)` — nigdy porzucone unhandled rejections |
| Listener error isolation | ✅ | try/catch wokół każdego state/connection listener callback |
| Socket error handler | ✅ | `socket.on("error", ...)` — zapobiega process crash |
| Error typing | ✅ | Consistent `error instanceof Error ? error.message : String(error)` |

### 5.3 Zasoby i zarządzanie pamięcią

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | ✅ | Centralne `clearTimers()` + resolve pending delay promise |
| Socket cleanup | ✅ | Idempotent z `socketClosed` flag |
| Listener unsubscribe | ✅ | `onStateUpdate`/`onConnectionEvent` zwracają `() => void` cleanup fn |
| `characteristicCache` bounded | ✅ | Stały zbiór ~30 characteristics — nie rośnie |
| `.unref()` na timerach | ✅ | Nie blokuje process exit |
| No event listener leaks | ✅ | `socket.off("message"/"error")` w cleanup |

### 5.4 Protokół MIIO/MIOT — analiza implementacji

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

**LED mapping — poprawne rozróżnienie MIOT vs Legacy:**

| Tryb | Właściwość | Wartości | Konwersja |
|------|-----------|---------|-----------|
| MIOT | `led` (siid:6, piid:1) | 0=bright, 1=dim, 2=off | `toNumber(v) !== 2` |
| Legacy | `led` ("on"/"off") | string | `toBoolean(v)` |
| Legacy | `led_b` (fallback) | 0=bright, 1=dim, 2=off | `toLegacyLed(v)`: `typeof v === "number" ? v !== 2 : toBoolean(v)` |

**MIOT batch read optimization:**
Jedna komenda `get_properties` z ~20 parametrami zamiast N rund. Fallback na per-property reads jeśli batch jest nieobsługiwany.

**Legacy batch read:**
Jedna komenda `get_prop` z ~19 aliasami (np. `["power", "fan_level", "favorite_level", ...]`). Zwraca tablicę wyników odpowiadającą kolejności parametrów.

### 5.5 Logowanie

| Aspekt | Status |
|--------|--------|
| Token nigdy nie logowany | ✅ |
| Address masking (`maskDeviceAddressInLogs`) | ✅ |
| SerialNumber używa `displayAddress` | ✅ |
| Poziomy: debug/info/warn/error | ✅ |
| Suppressed errors: `process.emitWarning` z context tagiem | ✅ |
| Connection lifecycle events logowane | ✅ |

### 5.6 Styl kodu

| Aspekt | Status |
|--------|--------|
| Biome linter (recommended rules) | ✅ |
| Biome formatter (space indent) | ✅ |
| EditorConfig (UTF-8, LF, 2-space) | ✅ |
| Consistent naming conventions | ✅ |
| No magic numbers (constants/config) | ✅ |
| No dead imports | ✅ |

**Ocena jakości kodu: 10/10**

---

## 6. Security & Supply Chain

### 6.1 Wrażliwe dane

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Token w logach | ✅ Nigdy | Sprawdzone: żaden `log` call nie zawiera `token` |
| Token w `error.message` | ✅ Nigdy | Komunikaty błędów nie zawierają tokenu |
| Token walidacja | ✅ | Regex `^[0-9a-fA-F]{32}$` w kodzie + `config.schema.json` pattern |
| IP masking | ✅ | `maskAddress()` + `displayAddress` propagacja |
| SerialNumber masking | ✅ | `buildSerialNumber(displayAddress)` — nie raw IP |

### 6.2 Protokół sieciowy

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| AES-128-CBC szyfrowanie | ✅ | Standard MIIO |
| Static IV | ℹ️ | Ograniczenie protokołu Xiaomi, nie kodu |
| Message ID filtering | ✅ | `sendAndReceive` filtruje response ID |
| Handshake validation | ✅ | Sprawdzenie magic + response length |
| WAN exposure | ✅ Brak | Tylko LAN UDP 54321 |
| README network hardening | ✅ | VLAN, ACL, egress blocking rekomendowane |
| No command injection | ✅ | JSON.stringify z typami, brak string interpolacji w komendach |

### 6.3 Dependencies & Supply Chain

| Aspekt | Status |
|--------|--------|
| **Runtime dependencies: 0** | ✅ |
| `npm audit`: 0 vulnerabilities | ✅ (zweryfikowane) |
| `package-lock.json` lockfileVersion 3 | ✅ |
| `engine-strict=true` w `.npmrc` | ✅ |
| Dependabot (npm weekly + Actions weekly) | ✅ |
| SHA-pinned GitHub Actions | ✅ (wszystkie) |
| SBOM CycloneDX | ✅ |
| OSV Scanner | ✅ |
| OpenSSF Scorecard | ✅ |
| npm provenance (`NPM_CONFIG_PROVENANCE: true`) | ✅ |
| PoLP workflow permissions | ✅ (`contents: read` default, write only where needed) |
| `files` w package.json (whitelist) | ✅ (`dist`, `config.schema.json`, docs) |
| No secrets in code | ✅ |

### 6.4 CI Security

| Aspekt | Status |
|--------|--------|
| Concurrency with cancel-in-progress | ✅ |
| `npm audit --audit-level=high` w CI | ✅ (ci.yml + release.yml) |
| Pre-release gates: audit → check → release | ✅ |
| `fetch-depth: 0` only in release (needed for semantic-release) | ✅ |
| `persist-credentials: false` w scorecard | ✅ |
| Minimal `id-token: write` only for provenance | ✅ |

**Ocena security: 10/10**

---

## 7. Testy i CI/CD

### 7.1 Testy

| Metryka | Wartość |
|---------|---------|
| Framework | vitest v4.0 |
| Testy | 84 (100% pass) |
| Pliki testowe | 9 |
| Pokrycie statements | 100% |
| Pokrycie branches | 100% |
| Pokrycie functions | 100% |
| Pokrycie lines | 100% |
| Thresholds enforced | ✅ (vitest.config.ts) |

**Kategorie testów:**

| Plik | Testów | Pokrywa |
|------|--------|---------|
| `accessory-platform-index.test.ts` | 15 | Accessory services, config validation, lifecycle, HomeKit bindings |
| `device-api.test.ts` | 2 | Read/write API contract |
| `device-client-branches.test.ts` | 19 | Queue, retry, listeners, timers, error isolation |
| `mappers.test.ts` | 4 | Fan level mapping, AQI thresholds |
| `miio-transport-coverage.test.ts` | 20 | Protocol, handshake, crypto, error paths, batch reads |
| `miio-transport-reliability.test.ts` | 8 | Retryable error handling, close idempotency, diagnostics |
| `mode-policy.test.ts` | 4 | Auto/Night switch state machine |
| `network-scenarios.test.ts` | 7 | S1-S7: realistic network failure/recovery scenarios |
| `reliability.test.ts` | 5 | Backoff computation, error classification, socket error handling |

**Jakość testów:**
- Fake timers (`vi.useFakeTimers`) — kontrolowane time-advancement
- DI-based mocking (interfejsy `MiioTransport`, `Logger`)
- FakeSocket dla UDP layer
- ScriptedTransport dla scenario-based testing
- Proper cleanup (`afterEach` z `vi.restoreAllMocks`, timer cleanup)

### 7.2 CI Pipeline

| Workflow | Trigger | Opis |
|----------|---------|------|
| `ci.yml` | push main + PR | 5 configurations matrix, lint + typecheck + test + coverage + audit |
| `release.yml` | push main | audit → check → semantic-release → npm publish |
| `supply-chain.yml` | push main + PR | SBOM CycloneDX + OSV Scanner |
| `scorecard.yml` | push main + weekly cron | OpenSSF Scorecard → SARIF → CodeQL |
| `labeler.yml` | PR open/sync/reopen | Auto-labels (src, test, ci, docs, deps) |

**CI Matrix:**

| Node | Homebridge | Lane |
|------|------------|------|
| 20 | 1.11.2 | full |
| 22 | 1.11.2 | full |
| 24 | 1.11.2 | full |
| 22 | beta (2.x) | full |
| 24 | beta (2.x) | smoke |

### 7.3 Release Pipeline

| Aspekt | Status |
|--------|--------|
| semantic-release v24 | ✅ |
| Conventional commits | ✅ (wymagane przez `commit-analyzer`) |
| Auto-generated changelog | ✅ (`@semantic-release/changelog`) |
| Git tag + GitHub release | ✅ (`@semantic-release/git`, `@semantic-release/github`) |
| npm publish z provenance | ✅ (`NPM_CONFIG_PROVENANCE: true`) |
| Pre-release gates | ✅ (`npm audit` + `npm run check`) |
| `check` = lint + typecheck + test + build | ✅ |
| `prepublishOnly` = lint + typecheck + test + build | ✅ |

**Ocena CI/CD: 10/10**

---

## 8. Weryfikacja README vs Kod (szczegółowa)

### 8.1 Pola konfiguracji — domyślne wartości i limity

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

### 8.2 Mapowania HomeKit — README vs kod

| README twierdzenie | Implementacja | Status |
|---|---|---|
| AQI ≤35 = Excellent (1) | `mappers.ts:23` `aqi <= 35 → 1` | ✅ |
| AQI 36–75 = Good (2) | `mappers.ts:27` `aqi <= 75 → 2` | ✅ |
| AQI 76–115 = Fair (3) | `mappers.ts:31` `aqi <= 115 → 3` | ✅ |
| AQI 116–150 = Poor (4) | `mappers.ts:35` `aqi <= 150 → 4` | ✅ |
| AQI >150 = Inferior (5) | `mappers.ts:39` `else → 5` | ✅ |
| AQI <0/NaN = UNKNOWN (0) | `mappers.ts:19` `!isFinite \|\| <0 → 0` | ✅ |
| PM2.5 = raw AQI [0, 1000] | `air-purifier.ts:421` `Math.min(1000, Math.max(0, state.aqi))` | ✅ |
| Mode AUTO: ON=auto, OFF=sleep | `mode-policy.ts:9-18` `resolveModeFromAutoSwitch` | ✅ |
| Mode NIGHT: ON=sleep, OFF=auto | `mode-policy.ts:20-29` `resolveModeFromNightSwitch` | ✅ |
| Mode ignored when power OFF | `air-purifier.ts:360-364` `null → skip` | ✅ |
| FilterLifeLevel = filter1_life | `air-purifier.ts:464-467` | ✅ |
| FilterChangeIndication ≤ threshold | `air-purifier.ts:477-487` | ✅ |
| RotationSpeed → favorite mode | `miio-transport.ts:580-586` MIOT batch: mode=2 + fan level | ✅ |
| AirPurifier (HB 2.x) / Switch (HB 1.x) | `air-purifier.ts:77-89` `Reflect.get(…, "AirPurifier")` | ✅ |
| Polling: operation=10s, sensor=30s | `device-client.ts:67-68` defaults | ✅ |
| Exponential backoff | `retry.ts:15-25` + `device-client.ts:199-258` | ✅ |
| Supported models (5) | `platform.ts:16-22` SUPPORTED_MODELS = config.schema.json enum | ✅ |

### 8.3 Features table vs services

| README feature | Service w kodzie | Warunek |
|----------------|-----------------|---------|
| AirPurifier (HB 2.x) | `AirPurifier:name` via Reflect.get | HB 2.x z service |
| Switch: Power (HB 1.x) | `Switch:Power` | HB 1.x fallback |
| Air Quality Sensor | `AirQualitySensor` | `enableAirQuality` (default true) |
| Temperature Sensor | `TemperatureSensor` | `enableTemperature` (default true) |
| Humidity Sensor | `HumiditySensor` | `enableHumidity` (default true) |
| Switch: Child Lock | `Switch:Child Lock` | `enableChildLockControl` (default false) |
| Switch: LED Night Mode | `Switch:LED Night Mode` | Zawsze |
| Switch: Mode AUTO ON/OFF | `Switch:Mode AUTO ON/OFF` | Zawsze |
| Switch: Mode NIGHT ON/OFF | `Switch:Mode NIGHT ON/OFF` | Zawsze |
| Filter Maintenance | `FilterMaintenance` | Zawsze |
| Contact: Filter Replace Alert | `ContactSensor:Filter Replace Alert` | `exposeFilterReplaceAlertSensor` (default false) |

**Pełna spójność README ↔ kod.** ✅

---

## 9. Lista krytycznych problemów (blokery publikacji na npm)

**Brak krytycznych blokerów. Projekt jest gotowy do publikacji na npm.**

---

## 10. Lista usprawnień (priorytetyzowana)

### LOW priority (drobne udoskonalenia, żadne nie jest wymagane)

| # | Usprawnienie | Uzasadnienie | Priorytet |
|---|-------------|--------------|-----------|
| L1 | Wyjaśnić PM2.5 vs AQI w README | `PM2_5Density` characteristic otrzymuje wartość AQI z urządzenia. Warto dodać notę, że jest to wartość AQI z czujnika PM2.5, nie surowy pomiar µg/m³ (co jest standardową praktyką w ekosystemie Homebridge). | Low |
| L2 | Rozważyć `setBuzzerVolume` w HomeKit | Metoda istnieje w `DeviceClient` i jest przetestowana, ale brak HomeKit service. Można dodać opcjonalny Buzzer volume slider (ew. Switch mute/unmute) w przyszłej wersji. | Low |
| L3 | `EDEVICEUNAVAILABLE` retry reduction | Gdy core properties (power/fan_level/mode) są niedostępne (np. niezgodny model), błąd jest retryowany 8 razy. Można zmniejszyć retries dla tego kodu lub dodać immediate failure dla known-bad models. | Low |
| L4 | Platform plugin migration (v2.0) | Multi-device support, auto-discovery. Obecny model `accessory` plugin z child bridge jest w pełni funkcjonalny. | Low (future) |
| L5 | Stale bot / auto-close workflow | Automatyczne zarządzanie stale issues. | Low |

### INFO (obserwacje, nie wymagają akcji)

| # | Obserwacja |
|---|-----------|
| I1 | `_address` param w `AirPurifierAccessory` constructor jest unused (prefixed `_`). Poprawne dla TS — pozwala na przyszłe użycie bez zmiany public API. |
| I2 | `motor1_speed`, `use_time`, `purify_volume` są czytane z urządzenia ale nie eksponowane w HomeKit. Informacje diagnostyczne w state — poprawne. |
| I3 | Static IV w AES-128-CBC — ograniczenie protokołu MIIO, nie kodu. Brak możliwości naprawy bez zmiany firmware. |
| I4 | AES-128-CBC jest deprecated w kontekście TLS, ale tutaj jest to standard protokołu lokalnego — akceptowalne. |

---

## 11. Ocena zgodności ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja i aliasy | 10/10 | |
| Lifecycle (init/shutdown) | 10/10 | |
| Error handling i resilience | 10/10 | |
| Config validation | 10/10 | Trójstronna spójność README/schema/code |
| Config schema / UI layout | 10/10 | 3 logiczne sekcje z expandable |
| HomeKit mapping accuracy | 10/10 | Wszystkie characteristics poprawne, w tym IDLE state |
| Reconnect stability | 10/10 | 7 scenariuszy testowych |
| Version compatibility (1.x/2.x) | 10/10 | Dynamic detection, CI matrix, enum fallbacks |
| **Łączna ocena** | **10/10** | |

---

## 12. Checklista „gotowe do npm"

### Metadata

| Element | Status |
|---------|--------|
| `name` (scoped or unique) | ✅ `homebridge-xiaomi-air-purifier-modern` |
| `version` | ✅ `1.0.0` |
| `description` | ✅ |
| `main` / `types` | ✅ `dist/index.js` / `dist/index.d.ts` |
| `files` (whitelist) | ✅ `dist`, `config.schema.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md` |
| `keywords` (discoverable) | ✅ 15 keywords |
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
| CHANGELOG | ✅ |
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
| .editorconfig | ✅ |
| .gitignore | ✅ |
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
| Concurrency control | ✅ |

### Build & Test

| Element | Status |
|---------|--------|
| lint (0 errors) | ✅ |
| typecheck (0 errors) | ✅ |
| test (84/84, 100% coverage) | ✅ |
| build (tsc) | ✅ |
| npm audit (0 vulnerabilities) | ✅ |
| npm pack --dry-run (34 files, 32.5 kB) | ✅ |
| Zero runtime dependencies | ✅ |
| Source maps w dist | ✅ |
| Declaration files w dist | ✅ |

---

## 13. Podsumowanie końcowe

**Projekt jest w pełni gotowy do publikacji na npm. Nie ma żadnych krytycznych ani ważnych problemów do naprawienia.**

| Metryka | Wartość |
|---------|---------|
| Linie kodu (src) | ~2100 |
| Linie testów | ~3700 |
| Test:Source ratio | ~1.78× |
| Pokrycie kodu | 100% (enforced) |
| Runtime dependencies | **0** |
| Known vulnerabilities | **0** |
| CI configurations | 5 (matrix: 5 nodes) |
| Supported Node versions | 20, 22, 24 |
| Supported Homebridge | 1.11.1+ / 2.x |
| Supported purifier models | 5 |
| Protocols supported | MIOT + Legacy MIIO (auto-detect) |
| HomeKit services | 11 (6 conditional) |
| npm package size | 32.5 kB |

### Oceny finalne

| Obszar | Ocena |
|--------|-------|
| Architektura i jakość kodu | 10/10 |
| Zgodność Homebridge 1.x/2.x | 10/10 |
| Testy i pokrycie | 10/10 |
| CI/CD i automatyzacja | 10/10 |
| Security & supply chain | 10/10 |
| Dokumentacja i OSS readiness | 10/10 |
| README vs kod spójność | 10/10 |
| **Ocena ogólna** | **10/10** |

Projekt reprezentuje złoty standard jakości dla wtyczek Homebridge: zero runtime dependencies, 100% pokrycie testami, profesjonalny CI/CD z provenance i SBOM, pełna dokumentacja OSS, i perfekcyjna spójność między dokumentacją a kodem.
