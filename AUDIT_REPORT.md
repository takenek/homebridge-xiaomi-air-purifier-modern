# Homebridge Plugin Audit Report — v4

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-03-01
**Audytor:** Claude (pełny code review + security audit + README vs kod)
**Poprzedni audyt:** v3 (2026-02-28) — wyniki H1–H3, M1, M4 naprawione między v3 a v4
**Zakres:** Każdy plik w repozytorium przeczytany i przeanalizowany. Wszystkie warstwy: transport → client → accessory → platform → CI/CD → dokumentacja.

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka opiera się wyłącznie na `node:crypto` i `node:dgram`. To absolutny złoty standard eliminujący ryzyko supply-chain niemal w 100%.

2. **100% pokrycie kodu testami** (statements, branches, functions, lines) — wymuszone progami w `vitest.config.ts`. 84 testy w 9 plikach (stosunek test:src ≈ 1.78×), w tym 7 scenariuszy sieciowych (restart urządzenia, utrata routera, packet loss, Wi-Fi outage).

3. **Profesjonalny pipeline CI/CD** — semantic-release z npm provenance, SBOM CycloneDX, OSV Scanner, Dependabot (npm + GitHub Actions), macierz CI na Node 20/22/24 × Homebridge 1.11.2/beta, permissions PoLP (least privilege).

4. **Solidna architektura** — czysty podział `MiioTransport → DeviceClient → AirPurifierAccessory → XiaomiAirPurifierAccessoryPlugin`, operation queue serializująca UDP, retry z exponential backoff + jitter, MIOT batch reads.

5. **Kompletna dokumentacja OSS** — README z konfiguracją/troubleshooting/AQI mapping/network hardening, `config.schema.json` z layoutem, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, CODEOWNERS, RELEASE_CHECKLIST, LICENSE MIT.

6. **Pełna kompatybilność Homebridge 1.x / 2.x** — dynamiczna detekcja `AirPurifier` service przez `Reflect.get()` z fallback na `Switch`, `ConfiguredName` opcjonalnie, `TargetAirPurifierState.onSet` obsługiwane, peerDeps = engines, CI matrix testuje obie wersje.

### Największe ryzyka / uwagi

1. **Legacy LED `led_b` numeric encoding** — `toBoolean(0) = false` w `readViaLegacy`, podczas gdy w MIOT value=0 oznacza LED włączony. Jeśli starsze urządzenie zwraca numeryczny `led_b=0` (jasność pełna), plugin błędnie ustawi `led=false`. Ryzyko ograniczone — urządzenia z legacy API zazwyczaj zwracają `"on"`/`"off"` dla `led`.

2. **`readViaLegacyBatch`: 13 równoległych UDP calls** — `Promise.all` na 13 `get_prop` zapytaniach. Starsze urządzenia mogą tracić pakiety przy takim obciążeniu; MIOT batch elegancko rozwiązuje ten problem jednym `get_properties` call.

3. **`EDEVICEUNAVAILABLE` w retryable codes** — gdy core properties (power/fan_level/mode) są niedostępne (np. zły model), błąd jest retryowany 8 razy zanim zostanie odrzucony. Przy rzeczywiście niezgodnym modelu przedłuża czas startu.

4. **`CurrentAirPurifierState` uproszczone mapowanie** — kod zawsze ustawia `PURIFYING_AIR` gdy `power=true`, ignorując `mode === "idle"`. Właściwszym mapowaniem byłoby `IDLE` dla `mode === "idle"`, `PURIFYING_AIR` dla pozostałych.

---

## 2. Status napraw z poprzednich audytów

| ID | Problem | Status |
|----|---------|--------|
| H1 | SerialNumber ujawniał raw IP nawet przy maskowaniu | ✅ Naprawione — `buildSerialNumber(displayAddress)` |
| H2 | Brak `TargetAirPurifierState.onSet` handlera | ✅ Naprawione — `air-purifier.ts:243-249` |
| H3 | Bug report template bez pola wersji pluginu | ✅ Naprawione — `plugin_version` field dodany |
| M1 | Brak SHA pinning GitHub Actions | ✅ Naprawione — wszystkie akcje SHA-pinned |
| M4 | Brak CODEOWNERS | ✅ Naprawione — `* @takenek` |

---

## 3. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/                           ~2100 linii
│   ├── index.ts                   Entry point (14 linii)
│   ├── platform.ts                Config validation, wiring (228 linii)
│   ├── accessories/
│   │   └── air-purifier.ts        HomeKit services/characteristics (588 linii)
│   └── core/
│       ├── device-client.ts       State management, polling, retry, queue (317 linii)
│       ├── miio-transport.ts      MIIO/MIOT UDP protocol (775 linii)
│       ├── mappers.ts             Fan level, AQI mapping (41 linii)
│       ├── mode-policy.ts         Auto/Night mode logic (30 linii)
│       ├── retry.ts               Exponential backoff (59 linii)
│       └── types.ts               TypeScript types (49 linii)
├── test/                          ~3700 linii, 84 testy
├── .github/
│   ├── workflows/                 ci.yml, release.yml, supply-chain.yml
│   ├── dependabot.yml / CODEOWNERS
│   ├── ISSUE_TEMPLATE/            bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── config.schema.json             Homebridge UI schema (203 linii)
├── biome.json / tsconfig.json / tsconfig.test.json / vitest.config.ts
├── .releaserc.json / .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
└── README.md / CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
    LICENSE / SECURITY.md / RELEASE_CHECKLIST.md
```

**Ocena struktury: Doskonała.** Czysty podział na warstwy, SRP przestrzegane, brak "god objects".

---

## 4. Zgodność ze standardami Homebridge 1.x i 2.x

### 4.1 Rejestracja i lifecycle

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `registerAccessory` | ✅ | Poprawne `export =` z `(api: API) => void` |
| `pluginAlias` match | ✅ | `XiaomiMiAirPurifier` = `ACCESSORY_NAME` w platform.ts |
| `displayName` | ✅ | `package.json:73` — widoczny w Homebridge UI |
| Init (non-blocking) | ✅ | `void client.init().then(...).catch(...)` — nie blokuje konstruktora |
| Shutdown | ✅ | `api.on("shutdown", ...)` w `air-purifier.ts:137-142` |
| Timer cleanup | ✅ | `clearTimers()` czyści 4 timery + resolve pending retry delay |
| Timer unref | ✅ | Wszystkie `.unref()` — nie blokują graceful shutdown |
| Socket cleanup | ✅ | Idempotent `close()` z `ERR_SOCKET_DGRAM_NOT_RUNNING` guard |
| Error isolation | ✅ | Shutdown i init errors jako `warn`, nie propagowane |

### 4.2 Reconnect i retry

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Exponential backoff | ✅ | base=400ms, max=15s (configurable), 8 retries, 20% jitter |
| 16 retryable error codes | ✅ | ETIMEDOUT, ECONNRESET, ENETDOWN, EHOSTUNREACH, EAI_AGAIN, … |
| Connection events | ✅ | `connected`/`disconnected`/`reconnected` z logowaniem |
| Handshake retry | ✅ | `call()` re-handshake po transport error |
| Session invalidation | ✅ | `this.session = null` po każdym transport error |
| No timer leaks | ✅ | Test [S5]: `getTimerCount() === 0` po shutdown |
| Retry-during-shutdown | ✅ | `destroyed` flag w `pollWithRetry` i `delay` |

### 4.3 Mapowanie HomeKit

| Oczyszczacz → HomeKit | Status | Komentarz |
|----------------------|--------|-----------|
| Power ON/OFF | ✅ | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch:On` (HB 1.x) |
| RotationSpeed | ✅ | Fan level 1–16 ↔ 0–100% z poprawnym round-trip |
| TargetAirPurifierState | ✅ | onGet + **onSet**: AUTO=auto, MANUAL=favorite |
| CurrentAirPurifierState | ⚠️ | `power ? PURIFYING_AIR : INACTIVE` — brak IDLE dla `mode==="idle"` |
| AirQuality | ✅ | ≤35=Excellent, ≤75=Good, ≤115=Fair, ≤150=Poor, >150=Inferior |
| PM2.5 Density | ✅ | Raw AQI clamped [0, 1000] µg/m³ |
| Temperature / Humidity | ✅ | Opcjonalne sensory |
| Filter Maintenance | ✅ | FilterLifeLevel + FilterChangeIndication z konfigurowalnym progiem |
| Filter Alert (Contact) | ✅ | Opcjonalny ContactSensor (`exposeFilterReplaceAlertSensor`) |
| Child Lock | ✅ | Opcjonalny Switch (`enableChildLockControl`) |
| LED / Mode AUTO/NIGHT | ✅ | Mode switches z power-guard |
| AccessoryInformation | ✅ | SerialNumber z `displayAddress` (maskowanie respektowane) |

### 4.4 Kompatybilność wersji

| Aspekt | Status |
|--------|--------|
| `engines.homebridge`: `^1.11.1 \|\| ^2.0.0` | ✅ |
| `peerDependencies` = `engines.homebridge` | ✅ |
| `engines.node`: `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` | ✅ |
| CI matrix: Node 20/22/24 × HB 1.11.2/beta | ✅ |
| Dynamic `AirPurifier` service detection | ✅ |
| Dynamic `ConfiguredName` detection | ✅ |
| Enum fallbacks (numeric defaults) | ✅ |

### Ocena zgodności Homebridge: **9.5/10**

---

## 5. Jakość kodu (Node.js / TypeScript)

### 5.1 Typowanie

| Aspekt | Status |
|--------|--------|
| `strict: true` + `noImplicitAny` | ✅ |
| `noUnusedLocals` + `noUnusedParameters` | ✅ |
| `noUncheckedIndexedAccess` | ✅ (rzadkie w HB ekosystemie) |
| `exactOptionalPropertyTypes` | ✅ |
| `noExplicitAny: error` (Biome) | ✅ |
| Target ES2022, module CommonJS | ✅ |

### 5.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | ✅ | Brak mieszania callbacks z promises |
| Operation queue | ✅ | `enqueueOperation` serializuje UDP — brak race conditions |
| Queue error isolation | ✅ | Rejected poprzednie operacje nie blokują kolejnych |
| `void promise.catch()` | ✅ | Wszystkie fire-and-forget paths |
| Listener error isolation | ✅ | try/catch wokół każdego callback |
| Socket error handler | ✅ | `socket.on("error", ...)` — zapobiega process crash |

### 5.3 Zasoby i zarządzanie pamięcią

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | ✅ | Centralne `clearTimers()` + resolve pending delay promise |
| Socket cleanup | ✅ | Idempotent z guard flag |
| Listener unsubscribe | ✅ | `onStateUpdate/onConnectionEvent` zwracają cleanup fn |
| `characteristicCache` | ✅ | Bounded Map — stały zbiór ~30 characteristics |
| `.unref()` na timerach | ✅ | Nie blokuje process exit |

### 5.4 Protokół MIIO/MIOT — szczegóły

**Szyfrowanie (AES-128-CBC):**
```
key = MD5(token)
iv  = MD5(key || token)
```
Standard protokołu Xiaomi — implementacja poprawna.

**LED mapping — asymetria MIOT vs Legacy:**

| Mode | Property | Value | Code result |
|------|----------|-------|-------------|
| MIOT | `led` (siid:6, piid:1) | 0=bright, 1=dim, 2=off | `toNumber(v) !== 2` → OK |
| Legacy | `led` ("on"/"off") | "on"/"off" | `toBoolean(v)` → OK |
| Legacy | `led_b` (fallback) | 0=bright, 1=dim, 2=off | `toBoolean(0) = false` → ⚠️ bug |

Jeśli `led` nie jest dostępny a `led_b` zwraca `0`, LED jest błędnie raportowany jako wyłączony.

**`set_level_fan` w MIOT — batch SET:**
```typescript
send([
  { did, siid: 2, piid: 5, value: 2 },      // mode = favorite
  { did, siid: 10, piid: 10, value: level }, // fan level
]);
```
Poprawne — jednocześnie ustawia tryb favorite i poziom wentylatora. Zgodne z README i protokołem MIOT.

### 5.5 Logowanie

| Aspekt | Status |
|--------|--------|
| Token nigdy nie logowany | ✅ |
| IP masking (`maskDeviceAddressInLogs`) | ✅ |
| Poziomy: debug/info/warn/error | ✅ |
| Suppressed errors: `process.emitWarning` z context tagiem | ✅ |

**Ocena jakości kodu: 9.5/10**

---

## 6. Security & Supply Chain

### 6.1 Wrażliwe dane

| Aspekt | Status |
|--------|--------|
| Token w logach | ✅ Nigdy |
| Token walidacja | ✅ Regex + UI schema pattern |
| IP masking | ✅ + SerialNumber używa `displayAddress` |

### 6.2 Protokół

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| AES-128-CBC | ✅ | Standard MIIO |
| Static IV | ℹ️ | Ograniczenie protokołu, nie kodu |
| Message ID filtering | ✅ | |
| WAN exposure | ✅ Brak | Tylko LAN UDP 54321 |
| README network hardening | ✅ | VLAN, ACL, egress blocking |

### 6.3 Dependencies & Supply Chain

| Aspekt | Status |
|--------|--------|
| Runtime deps | **0** |
| `npm audit` | ✅ 0 vulnerabilities |
| `package-lock.json` lockfileVersion 3 | ✅ |
| `engine-strict=true` | ✅ |
| Dependabot (npm + Actions) weekly | ✅ |
| SBOM CycloneDX | ✅ |
| OSV Scanner | ✅ |
| npm provenance | ✅ |
| SHA-pinned GitHub Actions | ✅ |
| PoLP workflow permissions | ✅ |

**Ocena security: 9.5/10**

---

## 7. Testy i CI/CD

### 7.1 Testy

| Aspekt | Status |
|--------|--------|
| Framework: vitest v4 | ✅ |
| 84 testy, 9 plików | ✅ |
| Pokrycie 100% (statements/branches/functions/lines) | ✅ |
| Fake timers (`vi.useFakeTimers`) | ✅ |
| 7 scenariuszy network (S1-S7) | ✅ |
| DI-based mocking przez interfejsy | ✅ |

### 7.2 CI Pipeline

| Job | Status |
|-----|--------|
| test (5 konfiguracji: Node 20/22/24 × HB 1.x/beta) | ✅ |
| audit (`npm audit --audit-level=high`) | ✅ |
| sbom (CycloneDX) | ✅ |
| osv-scanner | ✅ |
| cancel-in-progress concurrency | ✅ |

### 7.3 Release

| Aspekt | Status |
|--------|--------|
| semantic-release v24 z 6 pluginami | ✅ |
| Conventional commits wymagane | ✅ |
| Auto changelog + git tag + GitHub release | ✅ |
| npm publish z provenance | ✅ |
| Pre-release gates: audit → check → release | ✅ |
| `check` script: lint + typecheck + test + build (v4) | ✅ |

**Ocena CI/CD: 10/10**

---

## 8. Weryfikacja README vs Kod (szczegółowa)

### 8.1 Pola konfiguracji

| Pole | README domyślna | Kod domyślna | Opis README | Status |
|------|----------------|-------------|------------|--------|
| `enableAirQuality` | true | `normalizeBoolean(..., true)` | Expose AirQualitySensor | ✅ |
| `enableTemperature` | true | `normalizeBoolean(..., true)` | Expose TemperatureSensor | ✅ |
| `enableHumidity` | true | `normalizeBoolean(..., true)` | Expose HumiditySensor | ✅ |
| `enableChildLockControl` | false | `normalizeBoolean(..., false)` | Expose Child Lock | ✅ |
| `filterChangeThreshold` | 10, [0,100] | `normalizeThreshold` (10, clamp) | Filter warning % | ✅ |
| `exposeFilterReplaceAlertSensor` | false | `normalizeBoolean(..., false)` | Contact sensor | ✅ |
| `connectTimeoutMs` | 15000, min 100 | `normalizeTimeout(..., 15_000, 100)` | Handshake timeout | ✅ |
| `operationTimeoutMs` | 15000, min 100 | `normalizeTimeout(..., 15_000, 100)` | Operation timeout | ✅ |
| `reconnectDelayMs` | 15000 (max cap) | `maxDelayMs: reconnectDelayMs` | ~~Base delay~~ **Max delay cap (v4)** | ✅ |
| `keepAliveIntervalMs` | 60000, min 1000 | `normalizeTimeout(..., 60_000, 1_000)` | Keep-alive interval | ✅ |
| `operationPollIntervalMs` | 10000, min 1000 | `normalizeTimeout(..., 10_000, 1_000)` | Control poll interval | ✅ |
| `sensorPollIntervalMs` | 30000, min 1000 | `normalizeTimeout(..., 30_000, 1_000)` | Sensor poll interval | ✅ |
| `maskDeviceAddressInLogs` | false | `normalizeBoolean(..., false)` | IP masking | ✅ |

### 8.2 Mapowania HomeKit

| README twierdzenie | Kod | Status |
|---|---|---|
| AQI ≤35 = Excellent (1) | `aqi <= 35 → 1` | ✅ |
| AQI 36–75 = Good (2) | `aqi <= 75 → 2` | ✅ |
| AQI 76–115 = Fair (3) | `aqi <= 115 → 3` | ✅ |
| AQI 116–150 = Poor (4) | `aqi <= 150 → 4` | ✅ |
| AQI >150 = Inferior (5) | `else → 5` | ✅ |
| AQI <0/NaN = UNKNOWN (0) | `!isFinite(aqi) \|\| aqi < 0 → 0` | ✅ |
| PM2.5 = raw AQI clamped [0, 1000] | `Math.min(1000, Math.max(0, state.aqi))` | ✅ |
| Mode AUTO: ON=auto, OFF=sleep | `resolveModeFromAutoSwitch` | ✅ |
| Mode NIGHT: ON=sleep, OFF=auto | `resolveModeFromNightSwitch` | ✅ |
| Mode ignored when power OFF | `null` return → `handleModeSwitch(null)` → skip | ✅ |
| FilterLifeLevel = filter1_life | `state.filter1_life` | ✅ |
| FilterChangeIndication ≤ threshold | `state.filter1_life <= filterChangeThreshold` | ✅ |
| CONTACT_NOT_DETECTED = alert | `filter1_life <= threshold ? contactNotDetected` | ✅ |
| RotationSpeed → favorite mode | MIOT `set_level_fan`: mode=2 + fan level | ✅ |
| AirPurifier (HB 2.x) / Switch (HB 1.x) | `Reflect.get(api.hap.Service, "AirPurifier")` | ✅ |
| TargetAirPurifierState settable | `onSet: AUTO → "auto", MANUAL → "favorite"` | ✅ |
| **Filter Replace Alert w features** | ~~Brakowało~~ **Dodano (v4)** | ✅ |

### 8.3 `config.schema.json` vs `platform.ts` spójność

Wszystkie wartości domyślne i minimalne są w pełnej synchronizacji. ✅

---

## 9. Lista krytycznych problemów (blokery npm)

**Brak krytycznych blokerów.** Projekt jest gotowy do publikacji na npm.

---

## 10. Lista usprawnień (po v4)

### HIGH priority (nowe po v4)

| # | Usprawnienie | Uzasadnienie | Plik |
|---|-------------|--------------|------|
| H1 | `CurrentAirPurifierState.IDLE` dla `mode === "idle"` | Gdy power=on ale mode=idle, HomeKit powinien widzieć IDLE (1) zamiast PURIFYING_AIR (2) | `air-purifier.ts:392-395` |

### MEDIUM priority

| # | Usprawnienie | Uzasadnienie | Plik |
|---|-------------|--------------|------|
| M1 | Legacy LED `led_b` numeric fix | `toBoolean(0)=false` błędnie mapuje `led_b=0` (bright) jako off | `miio-transport.ts:458` |
| M2 | Sequential/batched legacy reads | 13 parallel UDP calls może powodować packet loss na starszych HW | `miio-transport.ts:466-493` |
| M3 | OpenSSF Scorecard action | Automatyczna ocena bezpieczeństwa repo | `.github/workflows/` |
| M4 | Auto-label workflow | PR size labels, type labels | `.github/workflows/` |

### LOW priority

| # | Usprawnienie | Uzasadnienie |
|---|-------------|--------------|
| L1 | `config.schema.json` layout reorganizacja | Sekcja "Sensors & Alerts" zawiera timeout/polling settings — oddzielić |
| L2 | `EDEVICEUNAVAILABLE` retry reduction | 8 retries przy niezgodnym modelu = zbędne opóźnienie |
| L3 | Platform plugin migration (v2.0) | Multi-device management, auto-discovery |
| L4 | Stale bot / auto-close | Automatyczne zarządzanie issues |
| L5 | `favorite` mode switch | Dedykowany switch dla manual/favorite mode |

---

## 11. Sugestie konkretnych zmian (niezaimplementowane)

### 11.1 `air-purifier.ts` — `CurrentAirPurifierState.IDLE` (H1)

```typescript
// Obecne (air-purifier.ts:392-395):
state.power
  ? this.api.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
  : this.api.hap.Characteristic.CurrentAirPurifierState.INACTIVE

// Zalecane:
state.power
  ? state.mode === "idle"
    ? this.api.hap.Characteristic.CurrentAirPurifierState.IDLE
    : this.api.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
  : this.api.hap.Characteristic.CurrentAirPurifierState.INACTIVE
```

### 11.2 `miio-transport.ts` — Legacy LED `led_b` numeric encoding (M1)

```typescript
// Obecne (line 458):
led: toBoolean(valueByKey.get("led")),

// Zalecane — obsługa numerycznych wartości led_b (0=bright, 1=dim, 2=off):
led: (() => {
  const v = valueByKey.get("led");
  if (typeof v === "number") return v !== 2;  // 0/1=on, 2=off
  return toBoolean(v);                         // "on"/"off" → standard
})(),
```

### 11.3 `config.schema.json` — Reorganizacja layout (L1)

```json
{
  "type": "section",
  "title": "Sensors & Alerts",
  "expandable": true,
  "expanded": false,
  "items": ["filterChangeThreshold", "exposeFilterReplaceAlertSensor", "enableChildLockControl"]
},
{
  "type": "section",
  "title": "Privacy & Timing",
  "expandable": true,
  "expanded": false,
  "items": [
    "maskDeviceAddressInLogs",
    "connectTimeoutMs", "operationTimeoutMs", "reconnectDelayMs",
    "keepAliveIntervalMs", "operationPollIntervalMs", "sensorPollIntervalMs"
  ]
}
```

---

## 12. Ocena finalna Homebridge compliance

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja | 10/10 | |
| Lifecycle | 10/10 | |
| Error handling | 10/10 | |
| Config validation | 10/10 | |
| Config schema / UI | 9/10 | Layout do reorganizacji |
| HomeKit mapping | 9/10 | `CurrentAirPurifierState.IDLE` niezaimplementowane |
| Reconnect stability | 10/10 | 7 scenariuszy testowych |
| Version compatibility | 10/10 | Dynamic detection, CI matrix |
| **Łączna ocena** | **9.75/10** | |

---

## 13. Checklista „gotowe do npm"

### Metadata

| Element | Status |
|---------|--------|
| `name`, `version`, `description` | ✅ |
| `main`, `types`, `files` | ✅ |
| `keywords` (15), `engines`, `peerDependencies` | ✅ |
| `homepage`, `repository`, `bugs` | ✅ |
| `license`, `author`, `displayName` | ✅ |
| `prepublishOnly`, `check` (lint+typecheck+test+build) | ✅ |
| `config.schema.json` (pluginAlias, pluginType, schema, layout) | ✅ |

### Dokumentacja

| Element | Status |
|---------|--------|
| LICENSE / README / CHANGELOG | ✅ |
| CONTRIBUTING / CODE_OF_CONDUCT / SECURITY | ✅ |
| Issue templates / PR template / CODEOWNERS | ✅ |

### Infrastruktura

| Element | Status |
|---------|--------|
| tsconfig (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes) | ✅ |
| biome.json (recommended + noExplicitAny: error) | ✅ |
| vitest.config.ts (100% threshold, v8) | ✅ |
| `.releaserc.json` (6 plugins) / `.npmrc` (engine-strict) | ✅ |

### CI/CD

| Element | Status |
|---------|--------|
| CI matrix (Node 20/22/24 × HB 1.x/2.x) | ✅ |
| Release (semantic-release + npm provenance) | ✅ |
| Supply chain (SBOM + OSV) | ✅ |
| Dependabot (npm + Actions) + SHA pinning | ✅ |

### Build/test

| Element | Status |
|---------|--------|
| lint / typecheck / test (84/84, 100%) / build | ✅ |
| `npm audit` 0 vulnerabilities | ✅ |
| Zero runtime dependencies | ✅ |
| Source maps w dist | ✅ |

### Opcjonalne (nie blokujące)

| Element | Status | Priorytet |
|---------|--------|-----------|
| `CurrentAirPurifierState.IDLE` | ❌ | High (UX) |
| Legacy LED `led_b` fix | ❌ | Medium |
| OpenSSF Scorecard | ❌ | Medium |
| Auto-labels | ❌ | Low |
| Platform plugin (v2.0) | ❌ | Low (future) |

---

## 14. Zmiany wprowadzone w audycie v4

| Zmiana | Plik | Typ |
|--------|------|-----|
| Fix opisu `reconnectDelayMs`: "Base delay" → "Maximum delay cap" | `README.md:94` | Doc fix |
| Dodano wiersz "Filter Replace Alert" do tabeli features | `README.md:26` | Doc fix |
| Dodano `npm run build` do skryptu `check` | `package.json:55` | Tool fix |
| Dodano dropdown `model` w bug report template | `.github/ISSUE_TEMPLATE/bug_report.yml` | DX fix |

---

## 15. Podsumowanie końcowe

**Projekt jest gotowy do publikacji na npm.**

| Metryka | Wartość |
|---------|---------|
| Linie kodu (src) | ~2100 |
| Linie testów | ~3700 |
| Test:Source ratio | ~1.78× |
| Pokrycie | 100% |
| Runtime dependencies | 0 |
| Vulnerabilities | 0 |
| CI configurations | 5 |
| Node versions | 20, 22, 24 |
| Homebridge | 1.11.1+ / 2.x |

### Rekomendacje priorytetowe

1. **H1** — `CurrentAirPurifierState.IDLE` dla `mode === "idle"` (UX improvement)
2. **M1** — Fix legacy LED `led_b` numeric encoding (potential bug na starszych HW)
3. **M2** — Rozważyć sequential legacy reads (reliability na starszych urządzeniach)
4. **L1** — Reorganizacja `config.schema.json` layout
5. **L3** — Planować migrację na `platform` plugin w v2.0

**Ocena ogólna: 9.6/10** — profesjonalny, produkcyjny projekt OSS gotowy do publikacji.
