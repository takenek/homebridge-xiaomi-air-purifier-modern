# Homebridge Plugin Audit Report v3 — Pełny Code Review & Audyt Jakości

**Plugin:** `homebridge-xiaomi-air-purifier-modern` (v1.0.0)
**Repozytorium:** `takenek/xiaomi-mi-air-purifier-ng`
**Audytor:** Niezależny przegląd AI (Claude Sonnet 4.6)
**Data:** 2026-02-25
**Zakres:** Pełny code review, architektura, bezpieczeństwo, CI/CD, Homebridge 1.x/2.x, gotowość do npm

---

## 1. Executive Summary

### Największe Plusy

1. **100% pokrycie testami** (z wyjątkiem warstwy sieciowej `miio-transport.ts`) — 9 zestawów testów, ~70 przypadków, 100% thresholds wymuszonych w CI przez Vitest/v8. Wyjątkowy standard dla ekosystemu Homebridge.
2. **Zero zależności produkcyjnych** — jedyne użyte moduły to `node:crypto` i `node:dgram` (wbudowane w Node.js). Eliminuje całkowicie ryzyko supply-chain dla użytkowników końcowych.
3. **Czysta architektura** — wyraźny podział odpowiedzialności: `miio-transport` → `device-client` → `mappers/mode-policy` → `air-purifier` → `platform`. Serializacja operacji przez kolejkę `Promise`, exponential backoff z jitterem, poprawne czyszczenie zasobów przy shutdown.
4. **Profesjonalne CI/CD** — lint (Biome), typecheck (tsc), test z coverage, build i `npm audit` dla Node 20/22/24. Publikacja z `--provenance` (npm transparency log).
5. **Kompletna dokumentacja OSS** — README, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, templates dla issues — wszystkie obecne i dobrze napisane.
6. **Poprawna kompatybilność Homebridge 1.x/2.x** — `engines` i `peerDependencies` poprawnie deklarują `^1.11.1 || ^2.0.0-beta.0`.

### Największe Ryzyka

1. **Semantyczny błąd ContactSensorState** — `getContactSensorState()` używa `CONTACT_DETECTED` gdy filtr wymaga wymiany. W rzeczywistym HAP `CONTACT_DETECTED = 0` (normalny, zielony), co oznacza, że sensor alertu filtra pokazuje stan "OK" gdy filtr jest zużyty i "alarm" gdy filtr jest OK. Testy maskują ten błąd przez celowe odwrócenie wartości enumu w fake HAP.
2. **Martwy kod: RotationSpeed/fan level** — `fanLevelToRotationSpeed`, `rotationSpeedToFanLevel`, `setFanLevel`, `setBuzzerVolume` są zaimplementowane, przetestowane i eksportowane, ale nigdy nie podłączone do żadnej charakterystyki HomeKit.
3. **`miio-transport.ts` (648 linii) wyłączony z coverage** — najbardziej złożony moduł (kryptografia, UDP, sesje, detekcja protokołu, fallback) jest całkowicie poza siatką regresji.
4. **Brak natywnej usługi `AirPurifier` HAP** — urządzenie jest rejestrowane jako seria `Switch`, niewidoczna dla HomeKit jako "oczyszczacz powietrza" w automatyzacjach i scenach.
5. **Używanie `AccessoryPlugin` API** — Homebridge 2.x preferuje `DynamicPlatformPlugin`. `AccessoryPlugin` jest nadal obsługiwany jako kompatybilność wsteczna, ale nowe wtyczki powinny korzystać z Platform API.

---

## 2. Krytyczne Problemy (Blokery Publikacji)

**Brak absolutnych blokerów technicznych.** Plugin jest technicznie publikalny. Jednak poniższy bug może powodować mylące zachowanie dla użytkowników końcowych.

---

## 3. Lista Ważnych Ulepszeń

### HIGH Priority

#### HIGH-1: Błąd semantyczny ContactSensorState (filter replace alert)

**Pliki:** `src/accessories/air-purifier.ts:208–213`, `test/accessory-platform-index.test.ts:138–141`

**Problem:** W rzeczywistym HAP:
- `ContactSensorState.CONTACT_DETECTED = 0` → kontakt wykryty, stan normalny (zielony w Home.app)
- `ContactSensorState.CONTACT_NOT_DETECTED = 1` → kontakt nie wykryty, stan alarmowy (pomarańczowy/czerwony)

Obecny kod, gdy filtr wymaga wymiany (`filterLife <= threshold`):
```typescript
// air-purifier.ts:211-213
return filterLife <= this.filterChangeThreshold
  ? getEnumValue(contact, "CONTACT_DETECTED", 1)      // ← BŁĄD: zwraca 0 z prawdziwym HAP
  : getEnumValue(contact, "CONTACT_NOT_DETECTED", 0);  // ← BŁĄD: zwraca 1 z prawdziwym HAP
```

Z prawdziwym HAP:
- Filtr wymaga wymiany → `CONTACT_DETECTED` → `0` → "normalny/zielony" ← **ŹRÓDŁO BŁĘDU**
- Filtr OK → `CONTACT_NOT_DETECTED` → `1` → "alarmowy/pomarańczowy" ← **ŹRÓDŁO BŁĘDU**

Test fake (`test/accessory-platform-index.test.ts:140-141`) celowo odwraca wartości:
```typescript
ContactSensorState: {
  UUID: "contactState",
  CONTACT_NOT_DETECTED: 0,  // ← odwrócone względem prawdziwego HAP
  CONTACT_DETECTED: 1,      // ← odwrócone względem prawdziwego HAP
}
```
To sprawia, że testy przechodzą, ale **maskują błąd produkcyjny**.

**Poprawka:**
```typescript
// air-purifier.ts — getContactSensorState()
private getContactSensorState(): number {
  const filterLife = this.client.state?.filter1_life ?? 100;
  const contact = this.api.hap.Characteristic.ContactSensorState as unknown as CharacteristicLike;
  return filterLife <= this.filterChangeThreshold
    ? getEnumValue(contact, "CONTACT_NOT_DETECTED", 1)  // LOW → alarm (1)
    : getEnumValue(contact, "CONTACT_DETECTED", 0);     // OK → normal (0)
}
```

Test fake powinien używać prawdziwych wartości HAP:
```typescript
ContactSensorState: {
  UUID: "contactState",
  CONTACT_DETECTED: 0,       // poprawnie jak w prawdziwym HAP
  CONTACT_NOT_DETECTED: 1,   // poprawnie jak w prawdziwym HAP
}
```

---

#### HIGH-2: Martwy kod — RotationSpeed/fan level i setBuzzerVolume

**Pliki:** `src/core/mappers.ts:6-17`, `src/core/device-client.ts:99-101, 115-117`, `src/accessories/air-purifier.ts`

`fanLevelToRotationSpeed`, `rotationSpeedToFanLevel` (mappers), `setFanLevel`, `setBuzzerVolume` (device-client) są kompletnie zaimplementowane i przetestowane, ale nie ma żadnej usługi HomeKit, która by je używała. Żadna charakterystyka `RotationSpeed` nie jest rejestrowana w `bindHandlers()`.

**Opcja A — Usuń martwy kod (jeśli funkcje nie są planowane):**
```typescript
// mappers.ts — usuń: fanLevelToRotationSpeed, rotationSpeedToFanLevel, FAN_LEVEL_MIN, FAN_LEVEL_MAX
// device-client.ts — usuń: setFanLevel(), setBuzzerVolume()
// test/mappers.test.ts — usuń testy tych funkcji
// test/device-api.test.ts — usuń weryfikację set_level_fan, set_buzzer_volume
```

**Opcja B — Podłącz do AirPurifier service (preferowane przy migracji do natywnego HAP):**
Patrz HIGH-3.

---

#### HIGH-3: Rozważyć migrację z Switch do natywnej usługi HAP AirPurifier

**Pliki:** `src/accessories/air-purifier.ts:48-59`, `config.schema.json`

**Obecny stan:** Power jest eksponowany jako `Service.Switch("Power")`. Tryby jako osobne `Switch`. HomeKit nie rozpoznaje tego jako "Air Purifier".

**HAP Service.AirPurifier zapewnia:**
- `Active` (0/1) → mapuje na power on/off
- `CurrentAirPurifierState` (Inactive=0, Idle=1, Purifying=2)
- `TargetAirPurifierState` (Manual=0, Auto=1)
- `RotationSpeed` (0-100%) → mapuje na fan_level 1-16 (już zaimplementowane w mappers.ts)

**Przykładowa struktura:**
```typescript
// Zastąp powerService + modeAutoService + modeNightService przez:
this.airPurifierService = new this.api.hap.Service.AirPurifier(name);

this.airPurifierService
  .getCharacteristic(Char.Active)
  .onGet(() => (this.client.state?.power ? 1 : 0))
  .onSet(async (value) => this.client.setPower(value === 1));

this.airPurifierService
  .getCharacteristic(Char.TargetAirPurifierState)
  .onGet(() => (this.client.state?.mode === "auto" ? 1 : 0))
  .onSet(async (value) => this.client.setMode(value === 1 ? "auto" : "sleep"));

this.airPurifierService
  .getCharacteristic(Char.RotationSpeed)
  .onGet(() => fanLevelToRotationSpeed(this.client.state?.fan_level ?? 1))
  .onSet(async (value) => this.client.setFanLevel(rotationSpeedToFanLevel(Number(value))));
```

**Uwaga:** Ta zmiana jest breaking change dla użytkowników (zmienia UUID usług, co resetuje konfigurację HomeKit). Powinna być wydana jako major version bump (2.0.0) ze stosownym ostrzeżeniem w CHANGELOG.

---

#### HIGH-4: miio-transport.ts wyłączony z coverage — ryzyko regresji

**Plik:** `vitest.config.ts:10`

`miio-transport.ts` to 648 linii obsługujących: detekcję protokołu, kryptografię AES-128-CBC, sesje MIIO, UDP handshake, korelację odpowiedzi po ID, batch MIOT reads, legacy fallback. Obecnie jest całkowicie poza wymaganiami coverage.

**Problemy wykryte podczas ręcznej analizy tego modułu:**

1. **Podwójne deszyfrowanie** (`sendAndReceive` + `sendCommand`): Każda odpowiedź na komend jest deszyfrowana dwukrotnie — raz w `sendAndReceive` do dopasowania `id` (linia 619-624), drugi raz w `sendCommand` (linia 553-555). Nieefektywność przy każdym RPC.

2. **Asymetryczna obsługa LED między MIOT i Legacy:**
   - MIOT: `led: toNumber(valueByKey.get("led")) !== 2` → false tylko gdy value=2
   - Legacy: `led: toBoolean(...)` → true gdy "on"/true/1
   - Prawdopodobnie poprawne dla różnych wariantów urządzeń, ale asymetria może powodować nieoczekiwane zachowanie.

3. **Brak weryfikacji checksumu odpowiedzi:** Protokół MIIO zawiera MD5 checksum w nagłówku odpowiedzi (bajty 16-31). Kod nie weryfikuje tej sumy. Urządzenie na LAN z fałszywymi odpowiedziami mogłoby nie zostać wykryte. (Minimalne ryzyko dla prywatnego LAN.)

4. **`session.deviceStamp + elapsed` potencjalny overflow:** `deviceStamp` to UInt32. Przy długim uptime urządzenia wartość może się przepełnić. (Teoretyczne, bardzo mało prawdopodobne w praktyce.)

**Rekomendacja:** Napisać testy dla `miio-transport.ts` używając fałszywego socketu UDP (np. `dgram` w trybie loopback lub mock), lub przenieść logikę detekcji protokołu i parsowania odpowiedzi do osobnych, testowalnych modułów.

---

### MEDIUM Priority

#### MED-1: AQI=0 mapuje na "Excellent" zamiast "Unknown"

**Plik:** `src/accessories/air-purifier.ts:136`, `src/core/mappers.ts:22-26`

Gdy stan urządzenia jest niedostępny:
```typescript
.onGet(() => aqiToHomeKitAirQuality(this.client.state?.aqi ?? 0))
//                                                              ^ 0 → "Excellent"
```

HAP `AirQuality` ma wartość `0 = UNKNOWN` i `1 = EXCELLENT`. Gdy dane z czujnika nie są dostępne, powinien być zwracany `UNKNOWN (0)`, nie `EXCELLENT (1)`.

**Poprawka:**
```typescript
.onGet(() => {
  const state = this.client.state;
  return state !== null ? aqiToHomeKitAirQuality(state.aqi) : 0; // 0 = UNKNOWN
})
```

A w mappers.ts rozważyć eksport stałej:
```typescript
export const HAP_AQI_UNKNOWN = 0 as const;
```

---

#### MED-2: Brak charakterystyki PM2_5Density

**Plik:** `src/accessories/air-purifier.ts:134-137`

Usługa `AirQualitySensor` w HAP obsługuje opcjonalną charakterystykę `PM2_5Density` (μg/m³). Urządzenie dostarcza surową wartość `aqi` (która jest PM2.5 w μg/m³ według chińskiej skali). Nie jest ona eksponowana.

```typescript
// Dodaj w bindHandlers() po AirQuality:
this.airQualityService
  .getCharacteristic(Char.PM2_5Density)
  .onGet(() => this.client.state?.aqi ?? 0);
```

---

#### MED-3: reconnectDelayMs — semantyczna pułapka konfiguracji

**Plik:** `src/platform.ts:99, 120-124`

```typescript
const reconnectDelayMs = normalizeTimeout(typedConfig.reconnectDelayMs, 15_000);
// ...
retryPolicy: {
  ...DEFAULT_RETRY_POLICY,
  baseDelayMs: reconnectDelayMs,  // ← zastępuje baseDelayMs=400ms przez 15000ms
},
```

`reconnectDelayMs` (domyślnie 15 000 ms) zastępuje `baseDelayMs` w całej polityce retry — nie tylko dla reconnect, ale też dla pierwszego połączenia po starcie. Przy `maxRetries=8`:
- Próba 1: base=15s → ~15s
- Próba 2: base*2=30s → ~30s (capped)
- Próby 3-8: każda ~30s
- Łączny czas do rezygnacji: nawet ~4.5 minuty

Dokumentacja i config.schema.json opisują to jako "Base delay used by reconnect backoff policy", co jest poprawne, ale nazwa `reconnectDelayMs` sugeruje użytkownikom coś innego (oczekiwany czas między próbami reconnect, a nie base wykładniczy).

**Rekomendacja:** Dodaj ostrzeżenie w README i config.schema.json wyjaśniające, że jest to wykładnicza baza, nie stały odstęp. Lub zmień nazwę na `retryBaseDelayMs` i zaktualizuj schemat (breaking change).

---

#### MED-4: Akcje GitHub Actions nie przypięte do SHA

**Pliki:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`

```yaml
# Obecny (ryzyko supply-chain):
uses: actions/checkout@v4
uses: softprops/action-gh-release@v2

# Zalecane (pinning do SHA):
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
uses: softprops/action-gh-release@c062e08bd532815e2082a7e09ce9571a6592c912  # v2.2.1
```

Użyj narzędzia `pinact` lub `renovate` do automatycznego pinowania i aktualizacji SHA.

---

#### MED-5: CI domyślnie przerywa wszystkie zadania matrycy przy niepowodzeniu

**Plik:** `.github/workflows/ci.yml`

Domyślnie `fail-fast: true` — jeśli Node 20 nie powiedzie się, Node 22 i 24 są anulowane. Oznacza to, że możesz przeoczyć błędy specyficzne dla wersji Node.

```yaml
strategy:
  fail-fast: false  # ← dodaj we wszystkich matrycach (lint, typecheck, test, build)
  matrix:
    node-version: [20, 22, 24]
```

---

#### MED-6: Statyczny SerialNumber "unknown"

**Plik:** `src/accessories/air-purifier.ts:46`

```typescript
.setCharacteristic(this.api.hap.Characteristic.SerialNumber, "unknown")
```

DeviceID jest dostępny po handshake w `session.deviceId`. Mógłby być użyty jako numer seryjny. Wymaga refaktoryzacji transportu, aby eksponować device ID po inicjalizacji.

---

### LOW Priority

#### LOW-1: Brak PR template

**Brak pliku:** `.github/pull_request_template.md`

Dodaj template aby standaryzować pull requesty:
```markdown
## Opis zmian

## Typ zmiany
- [ ] Bug fix
- [ ] Nowa funkcja
- [ ] Breaking change
- [ ] Aktualizacja dokumentacji

## Checklist
- [ ] Testy dodane/zaktualizowane
- [ ] CHANGELOG zaktualizowany
- [ ] Brak wrażliwych danych (tokenów, IP) w kodzie
```

---

#### LOW-2: @types/node: "^25.3.0" przy Node 20+ support

**Plik:** `package.json:55`

```json
"@types/node": "^25.3.0"
```

Wspierane wersje Node.js zaczynają się od 20, ale typy są dla Node 25. Może to eksponować API Node 25, które nie istnieje w Node 20/22. Żaden taki przypadek nie został znaleziony w aktualnym kodzie, ale jest to potencjalne ryzyko przy przyszłych zmianach.

**Opcja A:** `"@types/node": "^20.0.0"` — konserwatywne minimum
**Opcja B:** Zachowaj `^25.x` i dodaj do CI sprawdzenie typów na najniższej wspieranej wersji.

---

#### LOW-3: Brak commit-message convention w Dependabot

**Plik:** `.github/dependabot.yml`

```yaml
# Dodaj:
commit-message:
  prefix: "chore(deps)"
  prefix-development: "chore(dev-deps)"
  include: scope
```

Zapewnia kompatybilność z Conventional Commits i automatycznym changelogiem.

---

#### LOW-4: Brak fail-fast w release workflow

**Plik:** `.github/workflows/release.yml`

Release testuje tylko na Node 22. Warto dodać weryfikację, że commit był zbudowany w pełnym CI przed tagowaniem, np. przez `required status checks` w ustawieniach branch protection.

---

#### LOW-5: Brak coverage upload do zewnętrznej usługi

**Plik:** `.github/workflows/ci.yml`

Coverage jest uploadowane jako artefakt GitHub Actions (dobry start), ale nie ma integracji z Codecov/Coveralls, co umożliwiałoby śledzenie trendów coverage i komentarze w PR.

---

#### LOW-6: clearTimers() nie nulluje referencji do timerów

**Plik:** `src/core/device-client.ts:240-263`

```typescript
private clearTimers(): void {
  if (this.operationTimer) {
    clearInterval(this.operationTimer);
    // this.operationTimer = undefined;  ← brak
  }
  // ...
}
```

Jeśli `clearTimers()` zostanie wywołane dwukrotnie, `clearInterval` z już wyczyszczonym timer ID jest nieszkodliwy w Node.js, ale to nie jest idiomatyczne. Dodaj `this.operationTimer = undefined` po każdym `clearInterval`.

---

#### LOW-7: author w package.json bez email/url

**Plik:** `package.json:61`

```json
"author": "TaKeN"
// Lepiej:
"author": {
  "name": "TaKeN",
  "url": "https://github.com/takenek"
}
```

---

#### LOW-8: `pluginType` brak w package.json

Niektóre narzędzia Homebridge ekosystemu (np. homebridge-config-ui-x) czytają `pluginType` z `package.json`. Pole to jest obecne w `config.schema.json` jako `"pluginType": "accessory"`, ale nie w `package.json`. Choć nie jest to standard wymagany przez Homebridge, może być oczekiwane przez niektóre narzędzia ekosystemu.

---

## 4. Propozycje Zmian w Plikach

### 4.1 package.json — uzupełniony

```json
{
  "name": "homebridge-xiaomi-air-purifier-modern",
  "version": "1.0.0",
  "type": "commonjs",
  "description": "Modern Homebridge plugin for Xiaomi Mi Air Purifier (2H/3/3H/4/Pro)",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": [
    "homebridge-plugin",
    "homebridge",
    "xiaomi",
    "mi",
    "air-purifier",
    "homekit",
    "miio",
    "smart-home"
  ],
  "engines": {
    "node": "^20.0.0 || ^22.0.0 || ^24.0.0",
    "homebridge": "^1.11.1 || ^2.0.0-beta.0"
  },
  "author": {
    "name": "TaKeN",
    "url": "https://github.com/takenek"
  },
  "files": [
    "dist",
    "config.schema.json",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE"
  ]
}
```

Zmiana: rozszerzono `keywords` (więcej terminów pomocnych przy wyszukiwaniu), rozszerzono `author` o `url`.

---

### 4.2 CI — fail-fast i pinning

```yaml
# .github/workflows/ci.yml
lint:
  name: ci / lint
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false          # ← dodaj
    matrix:
      node-version: [20, 22, 24]
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
      with:
        node-version: ${{ matrix.node-version }}
        cache: npm
    - run: npm ci
    - run: npm run lint
```

---

### 4.3 dependabot.yml — conventional commits

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    labels:
      - dependencies
    commit-message:
      prefix: "chore(deps)"
      prefix-development: "chore(dev-deps)"
      include: scope

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    labels:
      - dependencies
      - github-actions
    commit-message:
      prefix: "chore(ci)"
      include: scope
```

---

### 4.4 Poprawka ContactSensorState (src/accessories/air-purifier.ts)

```typescript
// Linia 208-213 — PRZED (błędne):
private getContactSensorState(): number {
  const filterLife = this.client.state?.filter1_life ?? 100;
  const contact = this.api.hap.Characteristic.ContactSensorState as unknown as CharacteristicLike;
  return filterLife <= this.filterChangeThreshold
    ? getEnumValue(contact, "CONTACT_DETECTED", 1)       // BŁĄD: 0 w HAP = normalny
    : getEnumValue(contact, "CONTACT_NOT_DETECTED", 0);  // BŁĄD: 1 w HAP = alarm
}

// PO (poprawne):
private getContactSensorState(): number {
  const filterLife = this.client.state?.filter1_life ?? 100;
  const contact = this.api.hap.Characteristic.ContactSensorState as unknown as CharacteristicLike;
  return filterLife <= this.filterChangeThreshold
    ? getEnumValue(contact, "CONTACT_NOT_DETECTED", 1)   // alarm gdy filtr zużyty
    : getEnumValue(contact, "CONTACT_DETECTED", 0);      // normalny gdy filtr OK
}
```

I odpowiadające poprawki w teście:
```typescript
// test/accessory-platform-index.test.ts linia 138-141 — PRZED (celowo odwrócone):
ContactSensorState: {
  UUID: "contactState",
  CONTACT_NOT_DETECTED: 0,  // odwrócone!
  CONTACT_DETECTED: 1,      // odwrócone!
},

// PO (zgodne z prawdziwym HAP):
ContactSensorState: {
  UUID: "contactState",
  CONTACT_DETECTED: 0,
  CONTACT_NOT_DETECTED: 1,
},
```

---

### 4.5 AQI Unknown state

```typescript
// src/accessories/air-purifier.ts — bindHandlers()

// PRZED:
this.airQualityService
  .getCharacteristic(Char.AirQuality)
  .onGet(() => aqiToHomeKitAirQuality(this.client.state?.aqi ?? 0));

// PO:
this.airQualityService
  .getCharacteristic(Char.AirQuality)
  .onGet(() => {
    const state = this.client.state;
    return state !== null ? aqiToHomeKitAirQuality(state.aqi) : 0; // 0 = HAP UNKNOWN
  });
```

---

### 4.6 PR Template (.github/pull_request_template.md)

```markdown
## Opis

<!-- Krótki opis co zmienia ten PR i dlaczego -->

## Powiązane Issues

<!-- Closes #XXX -->

## Typ zmiany

- [ ] Bug fix (bez zmian API)
- [ ] Nowa funkcja (bez zmian API)
- [ ] Breaking change (zmiana API lub zachowania)
- [ ] Dokumentacja

## Checklist

- [ ] Testy dodane lub zaktualizowane
- [ ] Wszystkie testy przechodzą lokalnie (`npm test`)
- [ ] Lint OK (`npm run lint`)
- [ ] CHANGELOG.md zaktualizowany (jeśli dotyczy)
- [ ] Brak tokenów/adresów IP/credentials w kodzie lub testach
```

---

## 5. Ocena Zgodności z Homebridge 1.x / 2.x

### Wynik: **8/10**

| Kryterium | Status | Uwagi |
|-----------|--------|-------|
| Poprawna rejestracja wtyczki (`registerAccessory`) | ✅ | Zgodna z `AccessoryPlugin` API |
| `getServices()` → Array<Service> | ✅ | Poprawnie implementuje interfejs |
| Shutdown / `api.on("shutdown")` | ✅ | Poprawnie wywoływane, timery czyszczone |
| `engines.homebridge` zadeklarowane | ✅ | `^1.11.1 || ^2.0.0-beta.0` |
| `peerDependencies.homebridge` | ✅ | Zgodne z `engines` |
| Kompatybilność typów z Homebridge 2.x | ✅ | `skipLibCheck: true` w tsconfig |
| Natywna usługa `AirPurifier` HAP | ❌ | Używa `Switch`, brak automatyzacji HK |
| `DynamicPlatformPlugin` (preferowane 2.x) | ⚠️ | Używa `AccessoryPlugin` (nadal obsługiwane) |
| `ConfiguredName` fallback | ✅ | Poprawna obsługa starszych wersji |
| Obsługa utraty połączenia | ✅ | Exponential backoff, reconnection events |
| Walidacja konfiguracji | ✅ | Token hex, timeouty, progi |
| Logowanie na właściwych poziomach | ✅ | debug/info/warn poprawnie używane |
| Brak wrażliwych danych w logach | ✅ | Token nigdy nie logowany |
| Charakterystyki cache (bez duplikatów) | ✅ | `characteristicCache` z Map<UUID, value> |

**Komentarz:** Wtyczka jest solidnie zbudowana i działa poprawnie z Homebridge 1.x. Kompatybilność z 2.x jest zadeklarowana i powinna działać dzięki warstwie kompatybilności Homebridge. Główne zastrzeżenie to brak natywnej usługi `AirPurifier` HAP i użycie starszego `AccessoryPlugin` API.

---

## 6. Checklista "Gotowe do npm"

### Metadane Package

| Element | Status |
|---------|--------|
| `LICENSE` (MIT) | ✅ |
| `"license"` w package.json | ✅ |
| `"version"` semantyczna | ✅ `1.0.0` |
| `"description"` | ✅ |
| `"keywords"` z `"homebridge-plugin"` | ✅ |
| `"homepage"` | ✅ |
| `"repository"` | ✅ |
| `"bugs"` | ✅ |
| `"author"` | ⚠️ Brak `email`/`url` |
| `"engines"` (Node + Homebridge) | ✅ |
| `"peerDependencies"` | ✅ |
| `"files"` (tylko dist + docs) | ✅ |
| `"main"` → `dist/index.js` | ✅ |
| `"types"` → `dist/index.d.ts` | ✅ |
| Zero dependencji produkcyjnych | ✅ Tylko node: builtins |

### Dokumentacja OSS

| Element | Status |
|---------|--------|
| `README.md` z konfiguracją i przykładami | ✅ |
| `README.md` troubleshooting | ✅ |
| `CHANGELOG.md` | ✅ |
| `CONTRIBUTING.md` | ✅ |
| `CODE_OF_CONDUCT.md` | ✅ |
| `SECURITY.md` | ✅ |
| Issue templates (bug, feature, config) | ✅ |
| PR template | ❌ Brak |

### Konfiguracja TypeScript / Linting

| Element | Status |
|---------|--------|
| `tsconfig.json` (strict mode) | ✅ |
| `noUncheckedIndexedAccess` | ✅ |
| `exactOptionalPropertyTypes` | ✅ |
| `biome.json` (lint + format) | ✅ |
| `.editorconfig` | ✅ |
| `vitest.config.ts` | ✅ |

### Build i Publikacja

| Element | Status |
|---------|--------|
| `prepare` / `prepack` scripts | ✅ |
| `npm pack --dry-run` w CI | ✅ |
| `npm publish --provenance` | ✅ |
| `package-lock.json` | ✅ |
| `.npmrc` (engine-strict) | ✅ |

### CI/CD i Jakość

| Element | Status |
|---------|--------|
| CI: lint (Biome) | ✅ Node 20/22/24 |
| CI: typecheck (tsc) | ✅ Node 20/22/24 |
| CI: test (Vitest + coverage) | ✅ Node 20/22/24 |
| CI: build | ✅ Node 20/22/24 |
| CI: `npm audit` | ✅ `--audit-level=high` |
| CI: `fail-fast: false` | ❌ Domyślnie true |
| GitHub Actions pinning do SHA | ❌ Tylko `@v4` tagi |
| Dependabot (npm) | ✅ |
| Dependabot (GitHub Actions) | ✅ |
| Dependabot conventional commits | ❌ |
| Release workflow z tagowania | ✅ |
| Release z npm provenance | ✅ |
| Release: GitHub Release auto-notes | ✅ |
| Coverage upload (CI artifact) | ✅ |
| Coverage zewnętrzna usługa | ❌ Opcjonalne |

### Jakość Kodu

| Element | Status |
|---------|--------|
| 100% branch/line coverage (excl. transport) | ✅ |
| Zero dead code | ❌ `fanLevel*`, `setFanLevel`, `setBuzzerVolume` |
| Poprawna semantyka HAP | ❌ `ContactSensorState` odwrócony |
| AQI Unknown state obsługa | ❌ Zwraca Excellent zamiast Unknown |
| Natywna usługa AirPurifier HAP | ❌ |
| Miio transport coverage | ❌ Wyłączony |

---

## 7. Podsumowanie Wyników

### Co Działa Bardzo Dobrze

- **Zero runtime dependencies** — najlepszy możliwy profil bezpieczeństwa supply-chain
- **Exponential backoff z jitterem i serializowaną kolejką operacji** — solidna obsługa zawodności sieci
- **Dual-protocol (MIOT/Legacy) z automatyczną detekcją i fallback** — dobra kompatybilność z wariantami urządzeń
- **100% test coverage** dla wszystkich modułów poza warstwą sieciową
- **Strictest TypeScript config** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`)
- **Kompletny ekosystem OSS** (dokumentacja, szablony, Dependabot, CI, npm provenance)

### Co Wymaga Naprawy Przed Wydaniem v1.0.0

| Priorytet | Problem | Plik |
|-----------|---------|------|
| HIGH | ContactSensorState odwrócony (bug produkcyjny) | `air-purifier.ts:212-213` |
| HIGH | Martwy kod (fanLevel, setBuzzerVolume) | `mappers.ts`, `device-client.ts` |
| HIGH | miio-transport.ts bez coverage | `vitest.config.ts:10` |
| MED | AQI 0 → Excellent zamiast Unknown | `air-purifier.ts:136` |
| MED | Actions nie przypięte do SHA | `.github/workflows/*.yml` |
| MED | `fail-fast: false` brak w CI matrycy | `ci.yml` |
| LOW | Brak PR template | `.github/pull_request_template.md` |
| LOW | Brak commit-message w Dependabot | `dependabot.yml` |

### Ogólna Ocena

**9/10** — Wyjątkowo dojrzały projekt jak na wstępną wersję 1.0.0. Architektura jest czysta, testy solidne, dokumentacja kompletna. Główne obawy (ContactSensorState bug, martwy kod, brak natywnego AirPurifier service) są możliwe do naprawienia w bieżącym lub następnym wydaniu. Plugin **jest gotowy do publikacji na npm** z poprawką błędu ContactSensorState jako priorytetem #1.
