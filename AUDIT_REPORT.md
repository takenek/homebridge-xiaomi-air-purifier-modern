# Homebridge Plugin Audit Report

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-02-28
**Audytor:** Claude (pełny code review + security audit)
**Zakres:** Każdy plik w repozytorium przeczytany i przeanalizowany. Build, lint, typecheck, testy i npm pack zweryfikowane.

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka opiera się wyłącznie na Node.js built-ins (`node:crypto`, `node:dgram`). To absolutny złoty standard w ekosystemie Homebridge, eliminujący ryzyko supply-chain niemal w 100%.

2. **100% pokrycie kodu testami** (statements, branches, functions, lines) — wymuszone progami w `vitest.config.ts` z `thresholds: 100`. 84 testy w 9 plikach, w tym 7 scenariuszy network reliability (restart, reconnect, Wi-Fi outage). Test:source ratio wynosi 3703:2085 linii (~1.8x), co świadczy o solidnym pokryciu edge-case'ów.

3. **Profesjonalny pipeline CI/CD** — semantic-release z provenance npm, SBOM CycloneDX, OSV Scanner, Dependabot (npm + GitHub Actions), npm audit w CI, macierzowy test na Node 20/22/24 + Homebridge 1.11.2/beta. Trzy workflow'y (CI, Release, Supply Chain) z poprawnym `permissions` scoping.

4. **Solidna architektura** — czytelny podział na warstwy (`MiioTransport` → `DeviceClient` → `AirPurifierAccessory` → `XiaomiAirPurifierAccessoryPlugin`), pattern Observer dla aktualizacji stanu, operation queue serializująca dostęp do transportu, retry z exponential backoff + jitter, MIOT batch reads minimalizujące round-trips.

5. **Pełna dokumentacja OSS** — README z konfiguracją/troubleshooting/AQI mapping/network hardening, config.schema.json z layoutem, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, RELEASE_CHECKLIST, LICENSE (MIT).

6. **Kompatybilność Homebridge 1.x / 2.x** — dynamiczna detekcja `AirPurifier` service via `Reflect.get()` z graceful fallback na `Switch`, poprawne `peerDependencies`, testowane w CI z obu wersjami, `ConfiguredName` characteristic opcjonalnie stosowany gdy dostępny.

### Najważniejsze ryzyka / uwagi

1. **SerialNumber zawiera niezamaskowany IP** — `miap-10-0-0-1` jest ustawiany z surowego adresu nawet gdy `maskDeviceAddressInLogs: true` (`air-purifier.ts:543`). Nie stanowi to bezpieczeństwa krytycznego (SerialNumber jest widoczny tylko lokalnie w HomeKit), ale jest niespójne z intencją maskowania.

2. **Legacy batch reads generują N równoległych UDP calls** — `readViaLegacyBatch` (`miio-transport.ts:466-493`) wysyła osobny `get_prop` call per property, co oznacza ~13 równoległych UDP packetów. Na starszych urządzeniach może to prowadzić do packet loss. MIOT path poprawnie batchuje w jeden call.

3. **`pluginType: "accessory"`** — celowa decyzja architektoniczna (accessory-per-device), ale ogranicza możliwości multi-device management i automatycznego discovery. Nie jest to błąd — rozważyć migrację do `platform` w przyszłej wersji major.

4. **`TargetAirPurifierState` brak `onSet` handlera** — w native AirPurifier service path, użytkownik nie może zmienić trybu purifier bezpośrednio przez TargetAirPurifierState (tylko przez dedykowane switche AUTO/NIGHT). Świadome ograniczenie, ale może mylić użytkowników.

---

## 2. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/                           2085 linii
│   ├── index.ts                   Entry point — registerAccessory (14 linii)
│   ├── platform.ts                Config validation, wiring (227 linii)
│   ├── accessories/
│   │   └── air-purifier.ts        HomeKit service/characteristic mapping (579 linii)
│   └── core/
│       ├── device-client.ts       State management, polling, retry, queue (316 linii)
│       ├── miio-transport.ts      MIIO/MIOT UDP protocol implementation (774 linii)
│       ├── mappers.ts             Fan level ↔ rotation speed, AQI mapping (40 linii)
│       ├── mode-policy.ts         Auto/Night mode switch logic (29 linii)
│       ├── retry.ts               Exponential backoff, retryable error codes (58 linii)
│       └── types.ts               TypeScript types, ReadProperty tuple (48 linii)
├── test/                          3703 linii, 84 testy
├── .github/
│   ├── workflows/                 ci.yml, release.yml, supply-chain.yml
│   ├── dependabot.yml
│   ├── ISSUE_TEMPLATE/            bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── config.schema.json             Homebridge UI schema z layout (203 linii)
├── biome.json                     Linter/formatter config
├── tsconfig.json / tsconfig.test.json
├── vitest.config.ts
├── .releaserc.json                semantic-release config
├── .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
├── CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
├── LICENSE / SECURITY.md / RELEASE_CHECKLIST.md
└── README.md
```

**Ocena struktury: Doskonała** — czysty podział na warstwy, SRP przestrzegane, moduły mają jasne odpowiedzialności. Brak "god objects" — największa klasa (`ModernMiioTransport`, ~600 linii logiki) jest uzasadniona złożonością protokołu MIIO/MIOT.

---

## 3. Zgodność ze standardami Homebridge 1.x i 2.x

### 3.1 Rejestracja wtyczki

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `registerAccessory` | ✅ | `src/index.ts:9` — poprawne `export =` z `(api: API) => void` |
| `pluginAlias` match | ✅ | `config.schema.json:2` alias `XiaomiMiAirPurifier` = `ACCESSORY_NAME` w `platform.ts:13` |
| `pluginType: "accessory"` | ✅ | Celowy wybór; każdy oczyszczacz = osobna entry w `accessories[]` |
| `displayName` | ✅ | `package.json:72` — widoczne w Homebridge UI |
| `PLUGIN_NAME` consistency | ✅ | `homebridge-xiaomi-air-purifier-modern` w platform.ts i package.json |

### 3.2 Lifecycle management

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Init (constructor) | ✅ | `void client.init().then(...).catch(...)` — nie blokuje konstruktora Homebridge |
| Shutdown | ✅ | `api.on("shutdown", ...)` w `air-purifier.ts:137-142` — czyści timery + zamyka socket |
| Timer cleanup | ✅ | `clearTimers()` w `device-client.ts:278-301` czyści wszystkie 4 timery (operation, sensor, keepalive, retry) |
| Timer unref | ✅ | Wszystkie timery mają `.unref()` — nie blokują graceful shutdown Node.js |
| Error isolation | ✅ | Shutdown i init errors logowane jako `warn`, nie propagowane |
| Constructor throw safety | ✅ | Config validation errors thrown before transport init — safe early failure |

### 3.3 Obsługa restartów i reconnect

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Exponential backoff | ✅ | `retry.ts`: base=400ms, max=30s, 8 retries, 20% jitter |
| Jitter | ✅ | `(randomFn() * 2 - 1) * jitterRange` — symetryczny ±jitter |
| Retryable error codes | ✅ | 16 kodów sieciowych w `RETRYABLE_ERROR_CODES` |
| Connection events | ✅ | connected/disconnected/reconnected z logowaniem |
| Handshake retry | ✅ | `call()` automatycznie robi re-handshake po transport error |
| Session invalidation | ✅ | `this.session = null` po transport error w `call()` |
| No timer leaks | ✅ | Test `[S5]` potwierdza `getTimerCount() === 0` po shutdown |
| Retry-during-shutdown | ✅ | `destroyed` flag sprawdzany w `pollWithRetry` i `delay` |

### 3.4 Mapowanie HomeKit

| Oczyszczacz → HomeKit | Status | Komentarz |
|----------------------|--------|-----------|
| Power ON/OFF | ✅ | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch:On` (HB 1.x) |
| RotationSpeed | ✅ | Fan level 1-16 ↔ 0-100% z poprawnym round-trip |
| TargetAirPurifierState | ✅ | auto ↔ manual (onGet only — brak onSet, tryby zmieniane przez mode switches) |
| AirQuality | ✅ | 5-stopniowa skala: ≤35=Excellent, ≤75=Good, ≤115=Fair, ≤150=Poor, >150=Inferior |
| PM2.5 Density | ✅ | Raw AQI clamped do 0-1000 (`Math.min(1000, Math.max(0, state.aqi))`) |
| Temperature | ✅ | `CurrentTemperature` — opcjonalny (`enableTemperature`) |
| Humidity | ✅ | `CurrentRelativeHumidity` — opcjonalny (`enableHumidity`) |
| Filter Maintenance | ✅ | `FilterLifeLevel` + `FilterChangeIndication` z konfigurowalnym progiem |
| Filter Alert sensor | ✅ | Opcjonalny `ContactSensor` (`exposeFilterReplaceAlertSensor`) |
| Child Lock | ✅ | Opcjonalny Switch (`enableChildLockControl`) |
| LED | ✅ | Switch "LED Night Mode" |
| Mode AUTO/NIGHT | ✅ | Dedykowane switche z power-guard (mode change ignored when power OFF) |
| AccessoryInformation | ✅ | Manufacturer, Model, Name, SerialNumber |

### 3.5 Kompatybilność wersji

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `engines.homebridge` | ✅ | `^1.11.1 \|\| ^2.0.0` |
| `peerDependencies.homebridge` | ✅ | Identyczne z engines |
| `engines.node` | ✅ | `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` |
| CI matrix | ✅ | Node 20/22/24 × Homebridge 1.11.2 + Node 22/24 × Homebridge beta |
| `AirPurifier` service detection | ✅ | `Reflect.get()` z fallback na Switch |
| `ConfiguredName` detection | ✅ | Dynamiczne sprawdzanie + graceful skip |
| `FilterChangeIndication` enums | ✅ | `Reflect.get()` z numeric fallback values |
| `ContactSensorState` enums | ✅ | `Reflect.get()` z numeric fallback values |

### Ocena zgodności Homebridge: **9.5/10**

Jedyne zalecenie: rozważyć dodanie `TargetAirPurifierState.onSet` handlera (zmiana trybu auto/manual bezpośrednio z HomeKit) i migrację na `platform` plugin w przyszłej wersji major.

---

## 4. Jakość kodu (Node.js/TypeScript)

### 4.1 Typowanie TypeScript

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `strict: true` | ✅ | `tsconfig.json:9` |
| `noImplicitAny` | ✅ | Podwójne zabezpieczenie obok strict |
| `noUnusedLocals/Parameters` | ✅ | |
| `noUncheckedIndexedAccess` | ✅ | Doskonałe — rzadko widziane w ekosystemie |
| `exactOptionalPropertyTypes` | ✅ | Bardzo restrykcyjne — wymusza explicit undefined |
| `noExplicitAny` (Biome) | ✅ | `"error"` level w biome.json |
| Target | ✅ | ES2022 — odpowiednie dla Node 20+ (top-level await, private fields) |
| Module | ✅ | CommonJS — wymagane przez Homebridge |

**Ocena typowania: Wzorcowa (10/10)** — jedne z najostrzejszych ustawień TS w ekosystemie Homebridge.

### 4.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | ✅ | Brak mieszania callbacks z promises |
| Operation queue | ✅ | `enqueueOperation` serializuje dostęp do transport — zapobiega UDP race conditions |
| Queue error isolation | ✅ | Previous rejection nie blokuje następnych operacji (logged as `debug`) |
| Unhandled rejection safety | ✅ | Wszystkie `void promise.catch()` w fire-and-forget paths |
| Listener error isolation | ✅ | try/catch wokół state i connection listener callbacks |
| Socket error handler | ✅ | `socket.on("error", ...)` w `miio-transport.ts:198` — zapobiega process crash |
| Timeout management | ✅ | Konfigurowalne timeouty per-operation z cleanup |

### 4.3 Architektura

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Separation of concerns | ✅ | Transport → Client → Accessory → Platform — 4 czyste warstwy |
| Interface segregation | ✅ | `MiioTransport` interface w `types.ts` umożliwia testowanie |
| SRP | ✅ | Każdy moduł ma jedną odpowiedzialność |
| Testowalność | ✅ | DI przez constructor, interface-based mocking |
| No god objects | ✅ | Żaden plik nie przekracza 800 linii |
| Config validation | ✅ | Defensywne normalizacje: `assertString`, `assertHexToken`, `normalizeModel`, `normalizeThreshold`, `normalizeTimeout`, `normalizeBoolean` |
| Protocol detection | ✅ | Auto-detect MIOT vs legacy z fallback chain |

### 4.4 Zarządzanie zasobami

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | ✅ | Centralne `clearTimers()` — 4 timery (operation, sensor, keepalive, retry) + resolve pending delay |
| Socket cleanup | ✅ | `close()` z `socketClosed` idempotent guard + `ERR_SOCKET_DGRAM_NOT_RUNNING` handling |
| Event listener cleanup | ✅ | `onStateUpdate`/`onConnectionEvent` zwracają unsubscribe fn |
| Memory leaks | ✅ | `characteristicCache` to bounded Map (max ~30 entries, fixed set of characteristics) |
| `.unref()` na timerach | ✅ | Nie blokuje process exit |
| Operation queue drain | ✅ | Queue drains naturally; no orphaned promises possible |

### 4.5 Logowanie

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Log levels | ✅ | `debug`: diagnostics, suppressed errors; `info`: connection events, recovery; `warn`: failures, disconnects; `error`: config validation |
| Token w logach | ✅ | Nigdy nie logowany — walidacja w `platform.ts:61-69` |
| IP masking | ✅ | `maskDeviceAddressInLogs` → `10.10.*.*` pattern |
| Connection lifecycle | ✅ | Czytelne: `Connected to "X" @ IP!` / `Disconnected from "X" @ IP (code ...)` / `Reconnected to "X" @ IP.` |
| Suppressed errors | ✅ | Diagnostyczne `process.emitWarning()` z context tag, np. `[miio-transport:socket]` |

### 4.6 Polling i wydajność

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Dual-frequency polling | ✅ | Operation (10s default) + Sensor (30s default) — optymalny podział |
| Keep-alive | ✅ | 60s background heartbeat |
| Dedup characteristic updates | ✅ | `characteristicCache` zapobiega duplicate `updateCharacteristic` calls |
| MIOT batch reads | ✅ | Jeden `get_properties` call z wieloma property descriptorami |
| Legacy reads | ⚠️ | 13 równoległych `get_prop` calls — poprawne, ale może być zbyt agresywne na starych urządzeniach |
| Protocol caching | ✅ | Wykryty protocol mode (`miot`/`legacy`) cachowany na czas życia transport |

### Ocena jakości kodu: **9.5/10**

---

## 5. Security & Supply Chain

### 5.1 Wrażliwe dane

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Token w logach | ✅ | Nigdy nie logowany |
| Token walidacja | ✅ | Regex `^[0-9a-fA-F]{32}$` w kodzie i schema |
| Token w pamięci | ✅ | Przechowywany jako `Buffer` (16 bytes z hex-decode) |
| IP masking w logach | ✅ | Opcjonalne `maskDeviceAddressInLogs` |
| SerialNumber | ⚠️ | Zawiera raw IP (`miap-10-0-0-1`) nawet z maskowaniem włączonym — lokalny exposure |
| Config schema | ✅ | `"pattern"` walidacja tokena na poziomie UI |

### 5.2 Komunikacja z urządzeniem

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Protokół | UDP 54321 | MIIO standard — brak TLS, ale to wymóg protokołu Xiaomi |
| Szyfrowanie | AES-128-CBC | key = MD5(token), iv = MD5(key + token) — standard MIIO |
| Static IV | ⚠️ | IV nie zmienia się per-message — ograniczenie protokołu, nie kodu |
| Handshake | ✅ | Standard MIIO z device stamp + timeout |
| Message ID | ✅ | Incrementing ID z wraparound at 2^31-1 |
| Replay window | ✅ | Response filtering by expected message ID |
| README hardening | ✅ | Sekcja "Network hardening" z VLAN/firewall/ACL recommendations |
| Checksum | ✅ | MD5 checksum w header (standard MIIO) |

### 5.3 Dependencies

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Runtime deps | **0** | Absolutnie żadnych — złoty standard |
| Dev deps | 5 | `@biomejs/biome`, `@types/node`, `@vitest/coverage-v8`, `typescript`, `vitest` + homebridge (for types) |
| `npm audit` | ✅ | 0 vulnerabilities (zweryfikowane) |
| `package-lock.json` | ✅ | lockfileVersion 3, present in repo |
| `engine-strict=true` | ✅ | w `.npmrc` — wymusza engine check |
| No native addons | ✅ | Pure JS — brak problemów z node-gyp |

### 5.4 Supply chain automation

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Dependabot (npm) | ✅ | Weekly, 10 PR limit, `dependencies` label |
| Dependabot (GitHub Actions) | ✅ | Weekly, 5 PR limit, `dependencies` + `github-actions` labels |
| npm audit in CI | ✅ | `--audit-level=high` w `ci.yml:64` + `release.yml:27` |
| SBOM generation | ✅ | CycloneDX w `supply-chain.yml` — artifact uploaded |
| OSV Scanner | ✅ | `google/osv-scanner-action@v2.3.3` na lockfile |
| npm provenance | ✅ | `NPM_CONFIG_PROVENANCE: "true"` w release workflow |
| Pinned action tags | ⚠️ | `@v4` tags — rozważyć SHA pinning (tag hijacking protection) |
| No secret leaks | ✅ | Secrets only in release workflow via `${{ secrets.* }}` |

### 5.5 CI permissions (Least Privilege)

| Workflow | Permissions | Status |
|----------|-------------|--------|
| ci.yml | `contents: read` | ✅ Minimal |
| supply-chain.yml | `contents: read` | ✅ Minimal |
| release.yml | `contents: write, issues: write, pull-requests: write, id-token: write` | ✅ Required for semantic-release + npm provenance |

### Ocena security: **9/10**

---

## 6. Testy, CI/CD i automatyzacja

### 6.1 Testy

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Framework | vitest v4 | Nowoczesny, szybki, ESM-native |
| Pliki testowe | 9 | `test/` directory |
| Testy łącznie | 84 | All passing (zweryfikowane) |
| Pokrycie | **100%** | Statements, branches, functions, lines |
| Threshold enforcement | ✅ | `vitest.config.ts` — build fails < 100% |
| Coverage reporter | ✅ | `text` (terminal) + `lcov` (CI artifact) |
| Test isolation | ✅ | `vi.restoreAllMocks()` w afterEach |
| Fake timers | ✅ | `vi.useFakeTimers()` — testy nie czekają na real delays |
| Test categories | See below | |

**Kategorie testów:**

| Plik | Testy | Zakres |
|------|-------|--------|
| `mappers.test.ts` | 4 | Fan level mapping, AQI thresholds |
| `mode-policy.test.ts` | 4 | Auto/night switch policy |
| `device-api.test.ts` | 2 | Read/write device API contract |
| `device-client-branches.test.ts` | 19 | Queue, retry, listeners, edge cases |
| `network-scenarios.test.ts` | 7 | S1-S7: purifier restart, router restart, packet loss, HB restart, hot-reload, short/long Wi-Fi outage |
| `reliability.test.ts` | 5 | Backoff computation, retryable errors, socket error handler |
| `miio-transport-coverage.test.ts` | 20 | Protocol detection, batch/single reads, MIOT set mappings, handshake, encryption |
| `miio-transport-reliability.test.ts` | 8 | Retryable error propagation, socket close idempotency, batch round-trip |
| `accessory-platform-index.test.ts` | 15 | Service creation, config validation, characteristic updates, filter alerts, shutdown, AirPurifier service |

### 6.2 CI Pipeline

| Job | Zakres | Status |
|-----|--------|--------|
| `test` (matrix 5 configs) | lint + typecheck + test | ✅ Node 20/22/24 × HB 1.11.2, Node 22/24 × HB beta |
| `audit` | `npm audit --audit-level=high` | ✅ |
| `sbom` | CycloneDX SBOM generation + artifact | ✅ |
| `osv-scanner` | Vulnerability scanning via OSV | ✅ |
| Concurrency | `cancel-in-progress: true` | ✅ Saves CI minutes |
| Coverage artifact | Upload on `full` lane | ✅ |
| Cache | npm cache in `actions/setup-node` | ✅ |

**Smoke lane**: Node 24 × HB beta runs only test, not coverage — pragmatic approach for pre-release testing.

### 6.3 Release workflow

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| semantic-release v24 | ✅ | `.releaserc.json` z 6 pluginami |
| Conventional commits | ✅ | Wymagane przez commit-analyzer; opisane w CONTRIBUTING.md |
| Auto changelog | ✅ | `@semantic-release/changelog` → `CHANGELOG.md` |
| Auto npm publish | ✅ | `@semantic-release/npm` z `npmPublish: true` |
| npm provenance | ✅ | `NPM_CONFIG_PROVENANCE: "true"` via env |
| Git tag + commit | ✅ | `@semantic-release/git` z `[skip ci]` message |
| GitHub release | ✅ | `@semantic-release/github` |
| Pre-release gates | ✅ | `npm ci` → `npm audit` → `npm run check` (lint+typecheck+test) → release |
| `prepublishOnly` | ✅ | `npm run lint && npm run typecheck && npm test && npm run build` |
| `prepare` | ✅ | `npm run build` — auto-build on install |

### Ocena CI/CD: **10/10**

---

## 7. Lista krytycznych problemów (blokery publikacji npm)

**Brak krytycznych blokerów.** Projekt jest gotowy do publikacji na npm.

Weryfikacja:
- ✅ `npm run lint` — 0 errors, 0 warnings
- ✅ `npm run typecheck` — clean
- ✅ `npm test` — 84/84 passed, 100% coverage
- ✅ `npm run build` — clean compilation
- ✅ `npm audit` — 0 vulnerabilities
- ✅ `npm pack --dry-run` — 34 files, 32 kB (142 kB unpacked), correct content

---

## 8. Lista usprawnień (priorytetyzowana)

### HIGH priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| H1 | SerialNumber powinien respektować `maskDeviceAddressInLogs` | `air-purifier.ts:74` używa raw `address` zamiast `displayAddress` dla serial. Niespójne z intencją maskowania. Fix: `this.buildSerialNumber(displayAddress)` zamiast `this.buildSerialNumber(address)`. Albo: użyj hash(address) aby serial był unikalny ale nie ujawniał IP. |
| H2 | Dodać `TargetAirPurifierState.onSet` handler | W native AirPurifier service, zmiana trybu auto/manual z poziomu HomeKit powinna działać. Handler powinien mapować AUTO→`setMode("auto")`, MANUAL→keep current fan level (favorite mode). |
| H3 | Bug report template — brak pola wersji pluginu | Pole `plugin_version` w `bug_report.yml` znacząco przyspiesza triage. |

### MEDIUM priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| M1 | SHA pinning GitHub Actions | Tag `@v4` może być re-pointed. SHA pinning chroni przed supply-chain attacks na Actions. |
| M2 | Dodać OpenSSF Scorecard action | Automatyczna ocena bezpieczeństwa repo, widoczna na npm i GitHub. |
| M3 | Rozważyć batched legacy reads | `readViaLegacyBatch` wysyła N parallel calls. Niektóre legacy urządzenia wspierają multiple props w jednym `get_prop` call — można spróbować batch z fallback na individual. |
| M4 | Dodać `CODEOWNERS` | Automatyczne review assignments; ważne gdy projekt zyska kontrybutorów. |

### LOW priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| L1 | Rozważyć migrację na platform plugin w v2.0 | Automatyczne discovery urządzeń, UI-based device management, shared transport dla wielu oczyszczaczy. |
| L2 | `export =` → `export default` | Legacy CJS export syntax; `export default` jest bardziej idiomatyczne, ale wymaga zmian w module resolution. |
| L3 | Dodać stale-bot lub auto-close workflow | Automatyczne zarządzanie stale issues po 90 dniach. |
| L4 | Rozważyć dodanie `favorite` mode switch | Obecna logika mode switches obsługuje tylko auto/sleep. Użytkownicy z favorite mode (manual fan level) mogą chcieć dedykowanego switcha. |

---

## 9. Sugestie zmian w plikach

### 9.1 `air-purifier.ts` — SerialNumber masking fix

```typescript
// Obecne (line 73-75):
.setCharacteristic(
  this.api.hap.Characteristic.SerialNumber,
  this.buildSerialNumber(address),
);

// Zalecane:
.setCharacteristic(
  this.api.hap.Characteristic.SerialNumber,
  this.buildSerialNumber(displayAddress),
);
```

### 9.2 `bug_report.yml` — dodanie pola wersji pluginu

```yaml
- type: input
  id: plugin_version
  attributes: {label: Plugin version}
  validations: {required: true}
```

### 9.3 GitHub Actions — SHA pinning (example)

```yaml
# Obecne:
- uses: actions/checkout@v4

# Zalecane (przykładowy SHA — zweryfikować aktualny):
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

### 9.4 Opcjonalne: `TargetAirPurifierState.onSet` handler

```typescript
// W bindHandlers(), w bloku `this.usesNativePurifierService`:
this.purifierService
  .getCharacteristic(this.api.hap.Characteristic.TargetAirPurifierState)
  .onSet(async (value: CharacteristicValue) => {
    const isAuto = Number(value) === this.api.hap.Characteristic.TargetAirPurifierState.AUTO;
    await this.client.setMode(isAuto ? "auto" : "favorite");
  });
```

---

## 10. Ocena zgodności ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja | 10/10 | Poprawne `registerAccessory` z matching aliasami |
| Lifecycle | 10/10 | Init, shutdown, timer cleanup — wzorcowe |
| Error handling | 10/10 | Graceful degradation, retry with backoff, isolated listener errors |
| Config validation | 10/10 | Walidacja token (regex + hex), model (whitelist), timeoutów (clamp), threshold (normalize) |
| Config schema | 9/10 | Kompletny z layout — rozważyć dodanie `TargetAirPurifierState` onSet |
| HomeKit mapping | 9/10 | Kompletne z fallbackami; brak `TargetAirPurifierState.onSet` |
| Reconnect stability | 10/10 | Exponential backoff + jitter, connection events, tested w 7 scenariuszach |
| Version compatibility | 10/10 | Dynamiczna detekcja services, peerDeps=engines, CI matrix |
| **Łączna ocena** | **9.8/10** | |

---

## 11. Checklista „gotowe do npm"

### Metadata i pakiet

| Element | Status |
|---------|--------|
| `package.json` name: `homebridge-xiaomi-air-purifier-modern` | ✅ |
| `package.json` version: `1.0.0` (managed by semantic-release) | ✅ |
| `package.json` description | ✅ |
| `package.json` main: `dist/index.js` | ✅ |
| `package.json` types: `dist/index.d.ts` | ✅ |
| `package.json` files: dist, config.schema.json, docs | ✅ |
| `package.json` keywords (15) | ✅ |
| `package.json` engines (Node + Homebridge) | ✅ |
| `package.json` peerDependencies | ✅ |
| `package.json` homepage / repository / bugs | ✅ |
| `package.json` license: MIT | ✅ |
| `package.json` author: TaKeN | ✅ |
| `package.json` displayName | ✅ |
| `package.json` type: commonjs | ✅ |
| `package.json` prepublishOnly | ✅ |
| `package.json` prepare | ✅ |
| config.schema.json (pluginAlias, pluginType, schema, layout) | ✅ |

### Dokumentacja

| Element | Status |
|---------|--------|
| LICENSE (MIT) | ✅ |
| README.md (install, config, troubleshooting, development) | ✅ |
| CHANGELOG.md (Keep a Changelog format) | ✅ |
| CONTRIBUTING.md (conventional commits, local checks, PR process) | ✅ |
| CODE_OF_CONDUCT.md (Contributor Covenant 2.1) | ✅ |
| SECURITY.md (vulnerability reporting, SLA) | ✅ |
| RELEASE_CHECKLIST.md | ✅ |

### Infrastruktura

| Element | Status |
|---------|--------|
| .editorconfig | ✅ |
| .gitignore (node_modules, dist, coverage, *.tgz) | ✅ |
| .npmrc (engine-strict=true) | ✅ |
| package-lock.json (lockfileVersion 3) | ✅ |
| tsconfig.json (strict + advanced checks) | ✅ |
| tsconfig.test.json (extends, includes test/) | ✅ |
| biome.json (recommended + noExplicitAny: error) | ✅ |
| vitest.config.ts (100% threshold, v8 provider) | ✅ |
| .releaserc.json (6 plugins) | ✅ |

### CI/CD

| Element | Status |
|---------|--------|
| CI workflow (matrix test) | ✅ |
| Release workflow (semantic-release + provenance) | ✅ |
| Supply chain workflow (SBOM + OSV) | ✅ |
| Dependabot (npm + GitHub Actions) | ✅ |
| Issue templates (bug + feature + config) | ✅ |
| PR template (summary + checklist) | ✅ |

### Weryfikacja build/test

| Element | Status |
|---------|--------|
| `npm run lint` — clean | ✅ |
| `npm run typecheck` — clean | ✅ |
| `npm test` — 84/84, 100% coverage | ✅ |
| `npm run build` — clean | ✅ |
| `npm audit` — 0 vulnerabilities | ✅ |
| `npm pack --dry-run` — 34 files, 32 kB | ✅ |
| Zero runtime dependencies | ✅ |
| Source maps included in dist | ✅ |

### Opcjonalne (nie blokujące)

| Element | Status | Priorytet |
|---------|--------|-----------|
| SHA-pinned GitHub Actions | ❌ | Medium |
| OpenSSF Scorecard action | ❌ | Medium |
| CODEOWNERS | ❌ | Medium |
| Stale bot / auto-labels | ❌ | Low |
| `TargetAirPurifierState.onSet` | ❌ | High (UX) |

---

## 12. Szczegółowa analiza kodu — wyróżnione wzorce

### 12.1 Operation Queue (device-client.ts:177-197)

```
enqueueOperation() → serializes all transport access
├── previous.catch() → suppresses prior error (keeps queue alive)
├── await operation() → executes current
└── finally: release() → unblocks next queued item
```

Wzorzec jest poprawny i bezpieczny. Gwarantuje że nigdy nie dojdzie do równoczesnego dostępu do UDP socket. Testy potwierdzają odporność na rejected operations (`device-client-branches.test.ts:466-508`).

### 12.2 Protocol Auto-Detection (miio-transport.ts:301-325)

```
detectProtocolMode()
├── try MIOT probe (get_properties + MIOT_POWER_PROBE) → "miot"
├── try Legacy probe (get_prop + "power") → "legacy"
└── both fail → null (falls back to "legacy" in caller)
```

Pragmatyczne podejście — MIOT preferred (batch reads, newer protocol), z graceful degradation do legacy API.

### 12.3 Characteristic Cache Dedup (air-purifier.ts:562-578)

```
updateCharacteristicIfNeeded(service, characteristic, value)
├── build cache key: "serviceUUID:subtype:characteristicUUID"
├── compare with cached value
├── if same → skip (no HomeKit push)
└── if different → cache + updateCharacteristic()
```

Eliminuje unnecessary HomeKit notifications, zmniejszając overhead na 10-sekundowym polling cyklu.

### 12.4 Homebridge 1.x/2.x Compatibility Pattern

```
const AirPurifierService = Reflect.get(api.hap.Service, "AirPurifier");
this.usesNativePurifierService = Boolean(AirPurifierService);

// HB 2.x: AirPurifier service with Active, RotationSpeed, etc.
// HB 1.x: Switch fallback with On characteristic
```

Czyste, dynamiczne rozwiązanie bez hard-coded version checks.

---

## 13. Podsumowanie końcowe

**Projekt jest gotowy do publikacji na npm.** Jakość kodu, architektury, testów i infrastruktury CI/CD jest na poziomie znacznie powyżej przeciętnej w ekosystemie Homebridge.

### Kluczowe statystyki

| Metryka | Wartość |
|---------|---------|
| Source code | 2085 linii (8 plików) |
| Test code | 3703 linii (9 plików, 84 testy) |
| Test:Source ratio | 1.78x |
| Coverage | 100% (statements, branches, functions, lines) |
| Runtime dependencies | 0 |
| npm vulnerabilities | 0 |
| Package size | 32 kB (142 kB unpacked) |
| CI matrix | 5 configurations |
| Supported Node versions | 20, 22, 24 |
| Supported Homebridge | 1.11.1+ / 2.x |

### Kluczowe zalecenia na przyszłość

1. **H1** — Fix SerialNumber masking inconsistency (quick fix)
2. **H2** — Add `TargetAirPurifierState.onSet` for native AirPurifier UX
3. **M1** — SHA-pin GitHub Actions for supply-chain hardening
4. **L1** — Migrate to platform plugin in v2.0 for multi-device UX

**Ocena ogólna: 9.5/10** — profesjonalny, produkcyjny projekt OSS, gotowy do publikacji.
