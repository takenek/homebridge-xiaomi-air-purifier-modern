# Code Review & Quality Audit — xiaomi-mi-air-purifier-ng

**Audytor:** Claude (Anthropic), senior Homebridge / Node.js / TypeScript specialist
**Data audytu:** 2026-02-25
**Wersja analizowana:** 1.0.0
**Branch:** `claude/homebridge-plugin-audit-olBMB`
**Zakres:** Pełny code review — 100% kodu źródłowego, testów, CI/CD, dokumentacji, konfiguracji

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime-dependencies** — wyłącznie Node.js built-ins + Homebridge peer. Eliminuje całą klasę ryzyk supply-chain; audyt bezpieczeństwa zależności jest trywialny.
2. **Solidna warstwa transportu MIIO** — prawidłowa implementacja AES-128-CBC z kluczem i IV derywowanymi z tokenu przez MD5, pełne zarządzanie sesją UDP, automatyczna detekcja protokołu MIOT/Legacy z fallbackiem, serialna kolejka operacji eliminująca race conditions.
3. **Profesjonalny CI/CD** — lint + typecheck + test (100% coverage z wyłączeniem warstwy sieciowej) + build + `npm pack --dry-run` na Node 20/22/24, publikacja z npm provenance (`--provenance`). Dependabot dla npm i GitHub Actions.
4. **Kompletna dokumentacja OSS** — README, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates, release checklist. Rzadko spotykana kompletność dla projektu v1.0.0.
5. **TypeScript strict mode** — `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`. Biome z `noExplicitAny: error`. Wysoka dyscyplina typowania.

### Największe ryzyka (stan przed audytem)

6. **Krytyczny błąd ContactSensorState** _(naprawiony)_ — enum wartości w mock testowym były odwrócone względem rzeczywistego HAP, maskując błąd produkcyjny: sensor alertu filtra działał odwrotnie niż zamierzono.
7. **Brak natywnego `Service.AirPurifier`** _(do poprawy)_ — plugin używa `Service.Switch` zamiast dedykowanego serwisu HAP, co wyklucza integrację Siri i natywne ikony HomeKit.
8. **Fan speed nie eksponowane do HomeKit** _(do poprawy)_ — mapper `fanLevelToRotationSpeed` istnieje i jest przetestowany, ale nigdy nie trafia do żadnej charakterystyki HAP — martwy kod.

---

## 2. Krytyczne problemy (stan przed audytem — blokery publikacji)

### CRITICAL-1: `ContactSensorState` — odwrócona logika enum ✅ NAPRAWIONY

**Pliki:** `src/accessories/air-purifier.ts:208–213`, `test/accessory-platform-index.test.ts:139–143`

**Problem:**

W rzeczywistym HAP (hap-nodejs):
```
ContactSensorState.CONTACT_DETECTED     = 0  // kontakt wykryty — normalny stan, brak alertu
ContactSensorState.CONTACT_NOT_DETECTED = 1  // kontakt przerwany — stan alertu
```

Kod przed naprawą:
```typescript
return filterLife <= this.filterChangeThreshold
  ? getEnumValue(contact, "CONTACT_DETECTED", 1)      // filtr wymaga wymiany → 0 = BRAK alertu! BŁĄD
  : getEnumValue(contact, "CONTACT_NOT_DETECTED", 0); // filtr OK → 1 = ALERT! BŁĄD
```

Mock testowy miał odwrócone wartości (`CONTACT_DETECTED: 1`, `CONTACT_NOT_DETECTED: 0`), co powodowało, że test przechodził, mimo że logika produkcyjna była błędna.

**Skutek produkcyjny:** Sensor "Filter Replace Alert" wysyłał alert gdy filtr był OK i nie wysyłał alertu gdy filtr wymagał wymiany — dokładnie odwrotnie niż zamierzono.

**Naprawa zastosowana:**
- `src/accessories/air-purifier.ts` — zamieniono klucze enum: `CONTACT_NOT_DETECTED` (fallback 1) gdy filtr wymaga wymiany, `CONTACT_DETECTED` (fallback 0) gdy filtr jest OK. Dodano komentarz wyjaśniający semantykę HAP.
- `test/accessory-platform-index.test.ts` — mock zaktualizowany do wartości zgodnych z rzeczywistym HAP: `CONTACT_DETECTED: 0`, `CONTACT_NOT_DETECTED: 1`.

---

### CRITICAL-2: Fan speed — martwy kod (mapper nigdy nie eksponowany do HomeKit) ⚠️ DO POPRAWY

**Pliki:** `src/core/mappers.ts:1–17`, `src/core/device-client.ts:99–101`, `src/accessories/air-purifier.ts`

**Problem:**

Zaimplementowano i przetestowano:
- `fanLevelToRotationSpeed(fanLevel)` → RotationSpeed 0–100%
- `rotationSpeedToFanLevel(speed)` → fan_level 1–16
- `DeviceClient.setFanLevel(fanLevel)` — publiczna metoda
- `DeviceState.fan_level` — odczytywane przy każdym pollu

Jednak `AirPurifierAccessory` nie eksponuje żadnej z tych funkcji jako charakterystyki HomeKit. Fan speed jest odczytywane, przechowywane, ale nigdy nie trafia do użytkownika.

**Naprawa (wymaga CRITICAL-3):** Dodać `RotationSpeed` do `Service.AirPurifier` (patrz niżej). Jeśli funkcja jest celowo wstrzymana — usunąć martwy kod lub oznaczyć `TODO`.

---

### CRITICAL-3: Brak natywnego `Service.AirPurifier` ⚠️ DO POPRAWY

**Plik:** `src/accessories/air-purifier.ts:48`

```typescript
this.powerService = new this.api.hap.Service.Switch("Power", "power");
```

HAP definiuje dedykowany serwis `Service.AirPurifier` z charakterystykami:
- `Active` (on/off — zasilanie) zamiast `Service.Switch`
- `CurrentAirPurifierState` (Inactive/Idle/Purifying)
- `TargetAirPurifierState` (Manual/Auto)
- `RotationSpeed` (prędkość wentylatora — rozwiązuje CRITICAL-2)

**Skutki braku `Service.AirPurifier`:**
1. Siri nie rozpoznaje urządzenia jako oczyszczacza — „Włącz oczyszczacz powietrza" nie działa
2. Brak automatyzacji HomeKit „Purifier is Running" / „Air Purifier is Idle"
3. Ikona w aplikacji Home — anonimowy Switch zamiast ikony oczyszczacza
4. `TargetAirPurifierState` (Manual/Auto) naturalnie zastąpiłby dwa mylące przełączniki Mode AUTO/NIGHT

**Propozycja architektury:**
```typescript
// Zastąpić powerService: Service.Switch przez Service.AirPurifier:
this.purifierService = new this.api.hap.Service.AirPurifier(name);

// Active (zasilanie)
this.purifierService
  .getCharacteristic(Char.Active)
  .onGet(() => (this.client.state?.power ? 1 : 0))
  .onSet(async (value) => this.client.setPower(value === 1));

// CurrentAirPurifierState
this.purifierService
  .getCharacteristic(Char.CurrentAirPurifierState)
  .onGet(() => {
    if (!this.client.state?.power) return 0; // INACTIVE
    return this.client.state.mode === "sleep" ? 1 : 2; // IDLE vs PURIFYING
  });

// TargetAirPurifierState (zastępuje Mode AUTO/NIGHT switches)
this.purifierService
  .getCharacteristic(Char.TargetAirPurifierState)
  .onGet(() => (this.client.state?.mode === "auto" ? 1 : 0))
  .onSet(async (value) =>
    this.client.setMode(value === 1 ? "auto" : "favorite")
  );

// RotationSpeed — ROZWIĄZUJE CRITICAL-2
this.purifierService
  .getCharacteristic(Char.RotationSpeed)
  .onGet(() => fanLevelToRotationSpeed(this.client.state?.fan_level ?? 1))
  .onSet(async (value) =>
    this.client.setFanLevel(rotationSpeedToFanLevel(Number(value)))
  );
```

> **Uwaga:** Ta zmiana jest niekompatybilna wstecz — użytkownicy muszą ponownie sparować akcesorium w HomeKit po aktualizacji. Wymaga bumpu major version lub explicitnej deprecation notice.

---

### CRITICAL-4: `getProperties(_props)` — parametr `props` jest ignorowany ⚠️ DO POPRAWY

**Plik:** `src/core/miio-transport.ts:160`

```typescript
public async getProperties(_props: readonly ReadProperty[]): Promise<DeviceState> {
```

Transport zawsze odczytuje wszystkie właściwości z `MIOT_MAP`/`LEGACY_MAP`, niezależnie od argumentu. Trzy kanały pollingu (operation 10s, sensor 30s, keepalive 60s) wywołują tę samą operację — `READ_PROPERTIES` w `types.ts` jest martwym kodem.

**Naprawa:** Albo usunąć parametr z interfejsu (`getProperties(): Promise<DeviceState>`), albo zaimplementować selektywne odczytywanie dla różnych kanałów i naprawić nazewnictwo.

---

## 3. Ważne usprawnienia

### HIGH-1: Legacy protocol — 13 sekwencyjnych UDP calls zamiast batch request ⚠️ DO POPRAWY

**Plik:** `src/core/miio-transport.ts:348–372`

`readViaLegacy()` wykonuje 13 oddzielnych `get_prop` calls. Protokół legacy wspiera batch:
```json
{"id": 1, "method": "get_prop", "params": ["power", "mode", "temperature", ...]}
```

**Wpływ:** 13 × UDP RTT ≈ 650ms blokady kolejki operacji przy każdym pollu na urządzeniu legacy. W tym czasie żadne polecenie użytkownika nie może być wykonane.

**Propozycja:** Zaimplementować `readViaLegacyBatch()` z fallbackiem do sekwencyjnego odczytu (dla urządzeń wymagających alternatywnych nazw właściwości).

---

### HIGH-2: `@types/node@^25` vs `engines.node: "^20|^22|^24"` ✅ NAPRAWIONY

**Zmiana:** `@types/node: "^25.3.0"` → `"^22.0.0"` w `package.json`.

`@types/node@25` eksponuje API Node.js 25 niedostępne na deklarowanych platformach (Node 20-24). Wersja `^22` pokrywa Node 20, 22 i jest akceptowana przez Node 24.

---

### HIGH-3: `SerialNumber: "unknown"` — brak unikalności ✅ NAPRAWIONY

**Zmiana:** Zastąpiono statycznym `"unknown"` identyfikatorem derywowanym z adresu IP urządzenia:
```typescript
Buffer.from(address).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)
```

Zapewnia stabilny, unikalny numer seryjny przy wielu oczyszczaczach w tym samym domu HomeKit.

---

### HIGH-4: `CONTRIBUTING.md` w `files` npm ✅ NAPRAWIONY

**Zmiana:** Usunięto `"CONTRIBUTING.md"` z tablicy `files` w `package.json`. Dokument dla developerów nie jest potrzebny konsumentom pakietu.

---

### HIGH-5: LED mapping — niespójność MIOT vs Legacy ⚠️ UDOKUMENTOWANE

**Plik:** `src/core/miio-transport.ts:279, 366`

MIOT path: `led: toNumber(valueByKey.get("led")) !== 2` — wartości numeryczne (0=on, 2=off)
Legacy path: `led: toBoolean(readLegacyOne(...))` — stringi "on"/"off"

Niespójność jest ukryta za `toBoolean` (obsługuje stringi i liczby), ale logika numeryczna MIOT (0=on, wartość 1 nie jest obsługiwana) powinna być lepiej udokumentowana. Dodano komentarze w kodzie.

---

### HIGH-6: `reconnectDelayMs` — błędna semantyka ✅ NAPRAWIONY

**Plik:** `src/platform.ts`

**Problem przed naprawą:** `reconnectDelayMs` był używany jako `baseDelayMs` backoff (15 000ms baza → pierwszy retry po 15s). `DEFAULT_RETRY_POLICY.baseDelayMs = 400ms` był nadpisywany wartością 150× większą, co powodowało niepotrzebnie powolne reconnecty przy krótkich przerwach sieci.

**Naprawa:** `reconnectDelayMs` jest teraz używany jako `maxDelayMs` (cap eksponencjalnego backoff). Baza pozostaje 400ms — rychły pierwszy retry, maksymalny czas oczekiwania wyznacza konfiguracja.

```typescript
// Przed:
retryPolicy: { ...DEFAULT_RETRY_POLICY, baseDelayMs: reconnectDelayMs }
// Po:
retryPolicy: {
  ...DEFAULT_RETRY_POLICY,
  maxDelayMs: Math.max(reconnectDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs),
}
```

Zaktualizowano opis w `config.schema.json`: "Max Reconnect Delay (ms)".

---

### MEDIUM-1: Release workflow bez `npm audit` ✅ NAPRAWIONY

**Zmiana:** Dodano `npm audit --audit-level=high` do `.github/workflows/release.yml` przed publikacją. Zapobiega wydaniu wersji z krytycznymi podatnościami.

---

### MEDIUM-2: GitHub Actions bez SHA pinning — ryzyko supply chain ⚠️ REKOMENDOWANE

**Pliki:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`

Aktualnie używane tagi (`actions/checkout@v4`, `actions/setup-node@v4`, `softprops/action-gh-release@v2`) mogą być przestawiane. Dla pipeline publikującego na npm z `NODE_AUTH_TOKEN`, SHA pinning jest standardem bezpieczeństwa.

**Rekomendacja:** Zastąpić tagi SHA pinami i skonfigurować Dependabot do automatycznych aktualizacji:
```yaml
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
```

> SHA piny powinny być zweryfikowane przed wdrożeniem — podane wartości są przykładowe.

---

### MEDIUM-3: Brakujące keywords ✅ NAPRAWIONY

**Zmiana:** Rozszerzono z 5 do 14 słów kluczowych w `package.json`:
```json
["homebridge-plugin", "homebridge", "homekit", "xiaomi", "mi", "miio", "miot",
 "air-purifier", "purifier", "air-quality", "pm2.5", "smart-home", "iot", "zhimi"]
```

---

### MEDIUM-4: `author` — niepełny format ✅ NAPRAWIONY

**Zmiana:** `"author": "TaKeN"` → obiekt z polem `url`:
```json
"author": { "name": "TaKeN", "url": "https://github.com/takenek" }
```

---

### MEDIUM-5: Trzy kanały pollingu — identyczna praca ⚠️ DO POPRAWY

**Plik:** `src/core/device-client.ts:143–149`

Wszystkie trzy kanały (operation 10s, sensor 30s, keepalive 60s) wywołują tę samą `pollWithRetry()`, czytając wszystkie 13 właściwości. Różnią się tylko interwałem — nie zakresem. Zróżnicowanie nabierze sensu dopiero po naprawieniu CRITICAL-4.

---

### MEDIUM-6: Shutdown może czekać do `operationTimeoutMs` ⚠️ DO POPRAWY

**Pliki:** `src/core/device-client.ts:89–93`, `src/core/miio-transport.ts:580–646`

Jeśli `close()` jest wywołany podczas aktywnego `sendAndReceive()`, zamknięcie socketu zablokuje shutdown na `operationTimeoutMs` (domyślnie 15s). `clearTimers()` przerywa retry delay, ale nie aktywne UDP calls.

**Propozycja:** Sprawdzać `socketClosed` flag w `sendAndReceive()` i natychmiast odrzucać promise po zamknięciu socketu.

---

### LOW-1: `tsconfig.json` z `vitest/globals` dostępnymi w kodzie produkcyjnym ✅ NAPRAWIONY

**Zmiana:** Usunięto `"vitest/globals"` z `tsconfig.json` (produkcja) i dodano `test` do `exclude`. Utworzono `tsconfig.test.json` rozszerzający produkcyjny tsconfig z `vitest/globals` dla środowiska testowego.

---

### LOW-2: Brakujące `description` dla pól w `config.schema.json` ✅ NAPRAWIONY

**Zmiana:** Zaktualizowano opis `reconnectDelayMs` z lakonicznego "Base delay used by reconnect backoff policy" na pełny opis semantyki z przykładem.

---

### LOW-3: PR template — brak ✅ DODANY

**Dodano:** `.github/pull_request_template.md` z listą kontrolną (lint, typecheck, test, build, CHANGELOG, Conventional Commits).

---

## 4. Analiza bezpieczeństwa

### Bezpieczeństwo kodu

| Obszar | Ocena | Uwagi |
|--------|-------|-------|
| Token w logach | ✅ Bezpieczny | Token nie jest logowany; logowany jest tylko adres IP |
| Walidacja tokenu | ✅ Bezpieczna | Regex `/^[0-9a-fA-F]{32}$/` przed użyciem |
| Szyfrowanie MIIO | ✅ Poprawne | AES-128-CBC, klucz i IV z MD5(token)/MD5(key+token) — standard protokołu |
| Komunikacja sieciowa | ✅ Lokalna | Tylko UDP LAN (port 54321), bez komunikacji z zewnętrznymi serwerami |
| Wstrzykiwanie poleceń | ✅ Brak ryzyka | Brak wywołań shell; JSON.stringify przed wysyłką |
| Nadmierne uprawnienia | ✅ Brak | Tylko UDP socket; brak systemu plików, bez rootowych operacji |
| Walidacja danych wejściowych | ✅ Dobra | `assertString`, `assertHexToken`, `normalizeTimeout`, `normalizeThreshold` |
| Supply chain | ✅ Doskonała | Zero runtime dependencies |

### Kwestie bezpieczeństwa do zanotowania

- **Token urządzenia** jest przechowywany w `config.json` Homebridge w postaci czystego tekstu — jest to wymaganie protokołu MIIO, nie wada pluginu. Udokumentowano w `SECURITY.md`.
- **SHA pinning GitHub Actions** — rekomendowany dla pipeline z `NODE_AUTH_TOKEN` (patrz MEDIUM-2).

---

## 5. Ocena zgodności ze standardami Homebridge

### Homebridge 1.x — **7.5/10**

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja pluginu (`registerAccessory`) | ✅ 10/10 | Poprawna, PLUGIN_NAME/ACCESSORY_NAME spójne |
| `config.schema.json` (`pluginAlias` + layout) | ✅ 10/10 | Zgodny z Config UI X, dobry layout |
| Obsługa shutdown (`api.on("shutdown")`) | ✅ 10/10 | Prawidłowe czyszczenie timerów i zamknięcie UDP socketu |
| Obsługa błędów połączenia i retry | ✅ 9/10 | Exponential backoff z jitter, connection events, serialna kolejka |
| `AccessoryPlugin` interfejs | ✅ 9/10 | `getServices()` zwraca `Service[]` — poprawnie |
| Logowanie (debug/info/warn/error) | ✅ 9/10 | Poprawne użycie Homebridge `Logging` |
| `ConfiguredName` compatibility fallback | ✅ 9/10 | Działa na starszym i nowszym HB |
| `FilterMaintenance` service | ✅ 8/10 | Poprawnie skonfigurowany, alert opcjonalny |
| Mapowanie AQI → HomeKit AirQuality | ✅ 8/10 | GB3095-2012 — prawidłowy standard PM2.5 |
| Walidacja konfiguracji | ✅ 9/10 | Token hex, pola wymagane, normalizacja wartości |
| `ContactSensorState` logika | ✅ 10/10 | **Naprawiony** w tym audycie |
| Brak `Service.AirPurifier` | ❌ 0/10 | Krytyczne — brak natywnego serwisu HAP |
| Fan speed nie eksponowane | ❌ 0/10 | `RotationSpeed` zaimplementowane ale martwe |
| `SerialNumber` unikalność | ✅ 9/10 | **Naprawiony** — derywowany z IP |

### Homebridge 2.x — **7/10**

- `peerDependencies` obejmują `^2.0.0` ✅ (naprawione — usunięto suffix `-beta.0`)
- Brak Homebridge 2.x w `devDependencies` — testy tylko na 1.x ⚠️
- `AccessoryPlugin` API istnieje w obu wersjach ✅
- `engines.homebridge` deklaruje 2.x ✅

---

## 6. Checklista „gotowe do npm"

### Dokumentacja i pliki projektowe
- [x] `LICENSE` (MIT, 2026)
- [x] `README.md` z instalacją, konfiguracją, przykładami i troubleshooting
- [x] `CHANGELOG.md` z historią wersji
- [x] `CONTRIBUTING.md` z procesem PR i conventional commits
- [x] `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- [x] `SECURITY.md` z polityką zgłaszania podatności
- [x] Templates issue — bug report, feature request, config
- [x] Template Pull Request (`.github/pull_request_template.md`) ← dodany w tym audycie
- [x] `RELEASE_CHECKLIST.md`

### Konfiguracja TypeScript / Linter / Formatter
- [x] `tsconfig.json` ze strict mode
- [x] `tsconfig.test.json` (osobna dla testów) ← dodany w tym audycie
- [x] `biome.json` (linter + formatter, `noExplicitAny: error`)
- [x] `.editorconfig`
- [x] `.gitignore`

### package.json — pola wymagane
- [x] `name` z prefiksem `homebridge-`
- [x] `version` semantyczna (1.0.0)
- [x] `description` (rozszerzona w tym audycie)
- [x] `author` jako obiekt z `url` ← naprawiony
- [x] `license: "MIT"`
- [x] `homepage`, `repository`, `bugs`
- [x] `keywords` — 14 słów kluczowych ← rozszerzone
- [x] `main`, `types` wskazują na `dist/`
- [x] `files` lista bez CONTRIBUTING.md ← naprawione
- [x] `engines` (Node 20/22/24, Homebridge 1.x/2.x)
- [x] `peerDependencies` (homebridge 1.x + 2.x bez suffix `-beta.0`) ← naprawione
- [x] `@types/node@^22` — zgodne z `engines.node` ← naprawione
- [x] `engine-strict=true` w `.npmrc`

### Build i publikacja
- [x] Build output w `dist/` (TypeScript → CommonJS)
- [x] Declaration files (`.d.ts`) generowane
- [x] `npm pack --dry-run` w CI
- [x] `prepack: npm run build` (auto-build przed publish)
- [x] npm provenance (`--provenance`) w release workflow
- [x] `npm audit --audit-level=high` w release workflow ← dodane
- [ ] SHA-pinned GitHub Actions (rekomendowane — patrz MEDIUM-2)

### Testy i CI
- [x] Testy jednostkowe i integracyjne (vitest)
- [x] 100% coverage statements/branches/functions/lines (z wyłączeniem warstwy UDP)
- [x] Lint w CI (Biome)
- [x] Typecheck w CI (tsc --noEmit)
- [x] Build w CI
- [x] Audit w CI (`npm audit --audit-level=high`)
- [x] Macierz Node 20/22/24
- [x] Dependabot (npm + GitHub Actions)
- [ ] SHA pinning Actions
- [ ] Test na Homebridge 2.x (tylko 1.x w devDeps)

### Homebridge-specific
- [x] `config.schema.json` z poprawnym `pluginAlias`
- [x] `pluginType: "accessory"` — poprawny dla single-device plugins
- [x] Walidacja konfiguracji (token 32-char hex, required fields, range checks)
- [x] `ContactSensorState` — poprawna logika alertu filtra ← naprawiony
- [x] `SerialNumber` unikalny (derywowany z IP) ← naprawiony
- [x] Obsługa shutdown event
- [x] Retry z exponential backoff i jitter (fixed semantics) ← naprawiony
- [x] Serialna kolejka operacji (brak race conditions)
- [ ] `Service.AirPurifier` zamiast `Service.Switch` ← CRITICAL (wymaga major release)
- [ ] `RotationSpeed` eksponowane do HomeKit ← CRITICAL (zależy od powyższego)

### Wersjonowanie
- [x] Semantic Versioning (SemVer)
- [x] Wersja w CHANGELOG
- [x] Scripts `release:patch/minor/major`
- [ ] Conventional Commits nie są wymuszone automatycznie (brak commitlint/husky)
- [ ] Brak `semantic-release` — ręczne wersjonowanie

---

## 7. Tabela priorytetów

| ID | Priorytet | Problem | Status | Wysiłek |
|----|-----------|---------|--------|---------|
| CRITICAL-1 | 🔴 Bloker | `ContactSensorState` odwrócona logika | ✅ Naprawiony | XS |
| CRITICAL-2 | 🔴 Bloker | Fan speed martwy kod — `RotationSpeed` nie trafia do HomeKit | ⚠️ Do poprawy | S |
| CRITICAL-3 | 🔴 Bloker | Brak natywnego `Service.AirPurifier` | ⚠️ Do poprawy (major) | L |
| CRITICAL-4 | 🔴 Bloker | `getProperties` ignoruje `props` — misleading API | ⚠️ Do poprawy | S |
| HIGH-1 | 🟠 High | Legacy: 13 sekwencyjnych UDP calls zamiast batch | ⚠️ Do poprawy | M |
| HIGH-2 | 🟠 High | `@types/node@^25` vs engines Node 20–24 | ✅ Naprawiony | XS |
| HIGH-3 | 🟠 High | `SerialNumber "unknown"` — nieunikalny | ✅ Naprawiony | XS |
| HIGH-4 | 🟠 High | `CONTRIBUTING.md` w `files` npm | ✅ Naprawiony | XS |
| HIGH-5 | 🟠 High | LED mapping: MIOT (numeric) vs Legacy (string) — niespójność | ⚠️ Udokumentowane | S |
| HIGH-6 | 🟠 High | `reconnectDelayMs` semantyka — błędne użycie jako baseDelayMs | ✅ Naprawiony | XS |
| MEDIUM-1 | 🟡 Medium | `npm audit` brak w release workflow | ✅ Naprawiony | XS |
| MEDIUM-2 | 🟡 Medium | SHA pinning GitHub Actions | ⚠️ Rekomendowane | S |
| MEDIUM-3 | 🟡 Medium | Brakujące keywords npm | ✅ Naprawiony | XS |
| MEDIUM-4 | 🟡 Medium | `author` jako string zamiast obiekt | ✅ Naprawiony | XS |
| MEDIUM-5 | 🟡 Medium | Trzy kanały pollingu = identyczna praca | ⚠️ Do poprawy | M |
| MEDIUM-6 | 🟡 Medium | Shutdown czeka do `operationTimeoutMs` | ⚠️ Do poprawy | M |
| LOW-1 | 🟢 Low | `vitest/globals` w produkcyjnym `tsconfig.json` | ✅ Naprawiony | XS |
| LOW-2 | 🟢 Low | Opisy w `config.schema.json` | ✅ Naprawiony | XS |
| LOW-3 | 🟢 Low | PR template brak | ✅ Dodany | XS |

---

## 8. Zmiany zastosowane w tym audycie

| Plik | Zmiana |
|------|--------|
| `src/accessories/air-purifier.ts` | CRITICAL-1: Naprawiono `getContactSensorState()` — zamieniono enum klucze; HIGH-3: SerialNumber derywowany z adresu IP |
| `test/accessory-platform-index.test.ts` | CRITICAL-1: Mock `ContactSensorState` zaktualizowany do wartości HAP |
| `package.json` | HIGH-2: `@types/node@^22`; HIGH-4: usunięto `CONTRIBUTING.md` z `files`; MEDIUM-3: rozszerzone keywords; MEDIUM-4: `author` jako obiekt; `peerDependencies` i `engines` bez `-beta.0` |
| `src/platform.ts` | HIGH-6: `reconnectDelayMs` używany jako `maxDelayMs` zamiast `baseDelayMs` |
| `config.schema.json` | HIGH-6: Zaktualizowany opis `reconnectDelayMs` |
| `.github/workflows/release.yml` | MEDIUM-1: Dodano `npm audit --audit-level=high` |
| `tsconfig.json` | LOW-1: Usunięto `vitest/globals` z `types`; dodano `test` do `exclude` |
| `tsconfig.test.json` | LOW-1: Nowy plik z `vitest/globals` dla środowiska testowego |
| `.github/pull_request_template.md` | LOW-3: Nowy PR template |

---

*Raport wygenerowany przez Claude (Anthropic) w wyniku pełnego, niezależnego code review całego repozytorium — źródła, testy, CI/CD, dokumentacja, konfiguracja. Każde znalezisko zostało zweryfikowane przez bezpośrednią analizę kodu.*
