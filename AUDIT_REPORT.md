# Code Review & Quality Audit — xiaomi-mi-air-purifier-ng

**Audytor:** Claude (Anthropic), senior Homebridge/Node.js/TypeScript specialist
**Data:** 2026-02-25
**Wersja analizowana:** 1.0.0
**Branch:** `claude/homebridge-plugin-audit-MFbyc`
**Zakres:** Pełny code review — 100% kodu źródłowego, testów, CI/CD, dokumentacji

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime-dependencies** — wyłącznie Node.js built-ins + Homebridge peer. Eliminuje całą klasę problemów supply-chain i znacząco ułatwia utrzymanie i audyt.
2. **Solidna warstwa transportu MIIO** — prawidłowa implementacja AES-128-CBC, pełne zarządzanie sesją, auto-detekcja protokołu MIOT/Legacy z fallbackiem, serialna kolejka operacji eliminująca race conditions.
3. **Profesjonalny CI/CD** — lint + typecheck + test (100% coverage z wyłączeniem warstwy sieciowej) + build + `npm pack --dry-run` na Node 20/22/24, publikacja z npm provenance. Dependabot dla npm i GitHub Actions.
4. **Kompletna dokumentacja OSS** — README, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates, release checklist. Rzadko spotykana kompletność dla projektu v1.0.0.
5. **TypeScript strict mode** — `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`. Biome z `noExplicitAny: error`. Wysoka dyscyplina typowania.

### Największe ryzyka

6. **Krytyczny błąd ContactSensorState** — enum wartości w mock testowym są odwrócone względem rzeczywistego HAP, maskując błąd produkcyjny: sensor alertu filtra działa odwrotnie niż zamierzono (alert gdy filtr OK, brak alertu gdy filtr wymaga wymiany).
7. **Brak natywnego `Service.AirPurifier`** — plugin używa przełącznika (`Service.Switch`) zamiast dedykowanego serwisu HAP, co wyklucza integrację Siri i HomeKit Automation dla tego typu urządzenia.
8. **Fan speed nie jest eksponowane do HomeKit** — mapper `fanLevelToRotationSpeed` istnieje, jest przetestowany, ale nigdy nie jest podpięty do żadnej charakterystyki — martwy kod. Kontrola prędkości wentylatora to kluczowa funkcja oczyszczaczy.

---

## 2. Krytyczne problemy (blokery publikacji na npm)

### CRITICAL-1: `ContactSensorState` — odwrócona logika enum (błąd produkcyjny maskowany przez test)

**Pliki:** `src/accessories/air-purifier.ts:208–213`, `test/accessory-platform-index.test.ts:139–143`

**Problem:**

W rzeczywistym HAP (hap-nodejs):
```
ContactSensorState.CONTACT_DETECTED     = 0  // kontakt wykryty, normalny stan, brak alertu
ContactSensorState.CONTACT_NOT_DETECTED = 1  // kontakt przerwany, stan alertu
```

Kod w produkcji:
```typescript
// air-purifier.ts:210-213
return filterLife <= this.filterChangeThreshold
  ? getEnumValue(contact, "CONTACT_DETECTED", 1)      // filtr wymaga wymiany → zwraca 0 = BRAK alertu! ← BŁĄD
  : getEnumValue(contact, "CONTACT_NOT_DETECTED", 0); // filtr OK → zwraca 1 = ALERT! ← BŁĄD
```

Mock testowy ma odwrócone wartości względem prawdziwego HAP:
```typescript
// test/accessory-platform-index.test.ts:139-142
ContactSensorState: {
  UUID: "contactState",
  CONTACT_NOT_DETECTED: 0,  // BŁĄD: rzeczywista wartość HAP to 1
  CONTACT_DETECTED: 1,       // BŁĄD: rzeczywista wartość HAP to 0
},
```

**Skutek produkcyjny:** Sensor „Filter Replace Alert" wysyła alert do HomeKit gdy filtr jest OK, i nie wysyła alertu gdy filtr wymaga wymiany — dokładnie odwrotnie niż zamierzono. Testy przechodzą, bo test mock używa odwróconych wartości (błąd + błąd = test zielony, produkcja zepsuta).

**Naprawa `src/accessories/air-purifier.ts`:**
```typescript
private getContactSensorState(): number {
  const filterLife = this.client.state?.filter1_life ?? 100;
  const contact = this.api.hap.Characteristic.ContactSensorState as unknown as CharacteristicLike;
  // Filtr wymaga wymiany → CONTACT_NOT_DETECTED (1) = sensor "otwarty" = alert w HomeKit
  // Filtr OK             → CONTACT_DETECTED (0) = sensor "zamknięty" = brak alertu
  return filterLife <= this.filterChangeThreshold
    ? getEnumValue(contact, "CONTACT_NOT_DETECTED", 1)
    : getEnumValue(contact, "CONTACT_DETECTED", 0);
}
```

**Naprawa mocka testowego:**
```typescript
ContactSensorState: {
  UUID: "contactState",
  CONTACT_DETECTED: 0,        // zgodne z HAP
  CONTACT_NOT_DETECTED: 1,    // zgodne z HAP
},
```

---

### CRITICAL-2: Fan speed — martwy kod (mapper nigdy nie eksponowany do HomeKit)

**Pliki:** `src/core/mappers.ts:1–17`, `src/core/device-client.ts:99–101`, `src/accessories/air-purifier.ts`

**Problem:**

Zaimplementowano i przetestowano mapowanie prędkości wentylatora:
- `fanLevelToRotationSpeed(fanLevel)` — mapuje fan_level 1-16 → RotationSpeed 0-100%
- `rotationSpeedToFanLevel(speed)` — mapuje RotationSpeed → fan_level
- `DeviceClient.setFanLevel(fanLevel)` — metoda publiczna do ustawiania poziomu
- `DeviceState.fan_level` — pole w stanie urządzenia, odczytywane przy każdym pollu

**Jednak `AirPurifierAccessory` nie eksponuje żadnej z tych funkcji jako charakterystyki HomeKit.** Fan speed jest odczytywane, przechowywane, ale nigdy nie trafia do użytkownika. To martwy kod (dead code) — istniejący kod, który nigdy nie jest wywołany ścieżką produkcyjną.

**Naprawa:** Dodać `RotationSpeed` do `Service.AirPurifier` (patrz CRITICAL-3). Jeśli funkcja jest celowo wstrzymana — usunąć martwy kod lub dodać TODO z wyjaśnieniem.

---

### CRITICAL-3: Brak natywnego `Service.AirPurifier`

**Plik:** `src/accessories/air-purifier.ts:48`

**Problem:**

Plugin kontroluje zasilanie oczyszczacza przez `Service.Switch` zamiast `Service.AirPurifier`. HAP definiuje dedykowany serwis z charakterystykami:
- `Active` (on/off — zasilanie)
- `CurrentAirPurifierState` (Inactive/Idle/Purifying — aktualny stan)
- `TargetAirPurifierState` (Manual/Auto — tryb docelowy)
- `RotationSpeed` (prędkość wentylatora 0-100%)

**Skutki braku `Service.AirPurifier`:**
1. Siri nie rozpoznaje urządzenia jako oczyszczacza — „Włącz oczyszczacz powietrza" nie działa
2. Brak automatyzacji HomeKit „Purifier is Running" / „Air Purifier is Idle"
3. Urządzenie w aplikacji Home pojawia się bez ikony oczyszczacza — użytkownik widzi anonimowy Switch
4. `TargetAirPurifierState` (Manual/Auto) naturalnie zastąpiłby przełączniki Mode AUTO/NIGHT
5. `RotationSpeed` w `Service.AirPurifier` rozwiązuje CRITICAL-2

**Propozycja architektury:**
```typescript
// Zastąpić powerService: Service.Switch przez Service.AirPurifier:
this.purifierService = new this.api.hap.Service.AirPurifier(name);

// Active (zasilanie on/off)
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

// TargetAirPurifierState
this.purifierService
  .getCharacteristic(Char.TargetAirPurifierState)
  .onGet(() => (this.client.state?.mode === "auto" ? 1 : 0))
  .onSet(async (value) =>
    this.client.setMode(value === 1 ? "auto" : "favorite")
  );

// RotationSpeed — FAN SPEED! (rozwiązuje CRITICAL-2)
this.purifierService
  .getCharacteristic(Char.RotationSpeed)
  .onGet(() => fanLevelToRotationSpeed(this.client.state?.fan_level ?? 1))
  .onSet(async (value) =>
    this.client.setFanLevel(rotationSpeedToFanLevel(Number(value)))
  );
```

---

### CRITICAL-4: `getProperties(_props)` — parametr `props` jest ignorowany

**Plik:** `src/core/miio-transport.ts:160`

```typescript
public async getProperties(_props: readonly ReadProperty[]): Promise<DeviceState> {
```

Prefiks `_` wskazuje na celowe ignorowanie argumentu. Transport zawsze odczytuje wszystkie właściwości zdefiniowane w `MIOT_MAP`/`LEGACY_MAP`, niezależnie od tego, co zostanie przekazane.

**Konsekwencje:**
1. Interfejs `MiioTransport` obiecuje selektywne odczytywanie — abstrakcja przecieka (leaky abstraction)
2. Trzy kanały pollingu (operation 10s, sensor 30s, keepalive 60s) wykonują **dokładnie te same** operacje — zróżnicowanie interwałów istnieje, ale nie istnieje zróżnicowanie zakresu odczytu
3. Kanał keepalive (60s), który miał tylko „podtrzymać sesję UDP", wykonuje pełny odczyt wszystkich 13 właściwości — 13 UDP roundtrips przy każdym keepalive (legacy) lub 1 batch (MIOT)
4. `READ_PROPERTIES` w `types.ts` przekazywane do `getProperties()` jest martwym kodem — nigdy nie używane

**Naprawa:** Albo usunąć parametr z interfejsu (`getProperties(): Promise<DeviceState>`), albo zaimplementować selektywne odczytywanie dla różnych kanałów pollingu.

---

## 3. Ważne usprawnienia

### Priorytet HIGH

#### HIGH-1: Legacy protocol — 13 sekwencyjnych UDP calls zamiast jednego batch request

**Plik:** `src/core/miio-transport.ts:348–372`

```typescript
private async readViaLegacy(): Promise<DeviceState> {
  const powerRaw = await this.readLegacyOne(LEGACY_MAP.power ?? []);
  const fanLevelRaw = await this.readLegacyOne(LEGACY_MAP.fan_level ?? []);
  const modeRaw = await this.readLegacyOne(LEGACY_MAP.mode ?? []);
  // ... + kolejne 10 sekwencyjnych await ...
}
```

Protokół legacy (`get_prop`) wspiera batch odczytu wielu właściwości w jednym pakiecie UDP:
```json
{"id": 1, "method": "get_prop", "params": ["power", "mode", "temperature", "humidity", "aqi", ...]}
```
Urządzenie odpowiada tablicą wartości w tej samej kolejności.

**Wpływ na wydajność:** Przy każdym pollu na urządzeniu legacy: 13 × UDP RTT (≈50ms każdy) ≈ **650ms blokady kolejki operacji**. W tym czasie żadne polecenie użytkownika nie może być wykonane.

**Propozycja naprawy:**
```typescript
private async readViaLegacyBatch(): Promise<Map<string, unknown>> {
  const keys = Object.keys(LEGACY_MAP);
  // Użyj pierwszego kandydata dla każdego klucza jako primary property name
  const primaryCandidates = keys.map(k => LEGACY_MAP[k]?.[0]).filter(Boolean) as string[];

  try {
    const response = await this.call("get_prop", primaryCandidates);
    if (Array.isArray(response) && response.length === primaryCandidates.length) {
      const result = new Map<string, unknown>();
      primaryCandidates.forEach((candidate, i) => {
        const key = keys.find(k => LEGACY_MAP[k]?.[0] === candidate);
        if (key !== undefined) result.set(key, response[i]);
      });
      return result;
    }
  } catch (error: unknown) {
    if (isRetryableError(error)) throw error;
    // Fallback do sekwencyjnego odczytu z alternatywnymi kandydatami
  }

  // Sekwencyjny fallback:
  const result = new Map<string, unknown>();
  for (const [key, candidates] of Object.entries(LEGACY_MAP)) {
    result.set(key, await this.readLegacyOne(candidates));
  }
  return result;
}
```

---

#### HIGH-2: `@types/node@^25` vs `engines.node: "^20|^22|^24"` — niezgodność wersji

**Plik:** `package.json:55`

```json
"@types/node": "^25.3.0"   // typy dla Node 25
```

vs.

```json
"engines": {
  "node": "^20.0.0 || ^22.0.0 || ^24.0.0"   // obsługiwane Node 20-24
}
```

`@types/node@25` eksponuje typy API dostępnych w Node 25, których nie ma w Node 20/22/24 (np. nowe metody Stream, eksperymentalne API). TypeScript skompiluje poprawnie, ale może akceptować kod używający API niedostępnych na deklarowanych platformach docelowych.

**Naprawa:**
```json
"@types/node": "^22.0.0"
```
Wersja 22 zapewnia pełną kompatybilność z Node 20 i 22, jest akceptowana przez Node 24 (backward compatibility typów).

---

#### HIGH-3: `SerialNumber: "unknown"` — brak unikalności przy wielu urządzeniach

**Plik:** `src/accessories/air-purifier.ts:46`

```typescript
.setCharacteristic(this.api.hap.Characteristic.SerialNumber, "unknown");
```

Gdy użytkownik ma dwa oczyszczacze Xiaomi, oba mają `SerialNumber = "unknown"`. HomeKit może wyświetlać ostrzeżenia lub mieć problemy z identyfikacją. Numer seryjny powinien być deterministycznie unikalny.

**Naprawa:**
```typescript
.setCharacteristic(
  this.api.hap.Characteristic.SerialNumber,
  // Unikalny identyfikator oparty na adresie (deterministyczny, nieodwracalny)
  Buffer.from(address).toString("base64").slice(0, 16),
)
```

---

#### HIGH-4: `CONTRIBUTING.md` w `files` — publikowane na npm bez potrzeby

**Plik:** `package.json:34`

```json
"files": [
  "dist",
  "config.schema.json",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",   // <-- niepotrzebne dla konsumentów pakietu
  "LICENSE"
],
```

`CONTRIBUTING.md` to dokument dla developerów projektu, nie dla użytkowników pakietu npm. Zwiększa rozmiar pakietu bez wartości dla instalujących.

**Naprawa:** Usunąć `"CONTRIBUTING.md"` z `files`.

---

#### HIGH-5: LED mapping — niespójność MIOT vs Legacy

**Plik:** `src/core/miio-transport.ts:279, 366`

MIOT path:
```typescript
led: toNumber(valueByKey.get("led")) !== 2,  // 0=on, 2=off — wartość numeryczna
```

Legacy path:
```typescript
led: toBoolean(await this.readLegacyOne(LEGACY_MAP.led ?? [])),  // "on"/"off" — string
```

W MIOT, LED używa wartości numerycznych (0=maksymalna jasność/on, 2=LED wyłączony). W trybie legacy spodziewane są stringi `"on"`/`"off"`. Jeśli urządzenie legacy zwróci wartość liczbową (np. z powodu firmware różnic), `toBoolean(0)` = `false` i `toBoolean(1)` = `true`, co może dawać niepoprawne wyniki.

Brak testów weryfikujących tę konwersję przy przełączaniu między MIOT i legacy na tym samym urządzeniu. Warto dodać eksplicytną konwersję lub dokumentację.

---

#### HIGH-6: Mylące `reconnectDelayMs` → faktycznie jest `baseDelayMs` exponential backoff

**Plik:** `src/platform.ts:99, 120–123`, `config.schema.json`

```typescript
const reconnectDelayMs = normalizeTimeout(typedConfig.reconnectDelayMs, 15_000);
// ...
retryPolicy: {
  ...DEFAULT_RETRY_POLICY,
  baseDelayMs: reconnectDelayMs,  // domyślnie 15 000ms jako baza backoff!
},
```

Użytkownik widzi w schemacie "Reconnect Delay (default: 15000ms)" i myśli o prostym opóźnieniu przed ponownym połączeniem. W rzeczywistości to **baza eksponencjalnego backoff**:
- Retry 1: ~15s, Retry 2: ~30s (max), Retry 3-8: ~30s każdy
- Łączny czas do rezygnacji: do ~195 sekund

Nadpisuje też `DEFAULT_RETRY_POLICY.baseDelayMs = 400ms` (sensowna baza dla szybkich sieci), zastępując go 15 000ms — wymuszona powolność od pierwszego retry.

**Naprawa:** Dodać oddzielne pole konfiguracyjne `reconnectBaseDelayMs` lub udokumentować semantykę eksponencjalnego backoff w README. Ewentualnie przywrócić domyślne `baseDelayMs = 400ms` i zachować `reconnectDelayMs` jako alias dla innego parametru (np. `maxDelayMs`).

---

### Priorytet MEDIUM

#### MEDIUM-1: Release workflow bez `npm audit` i bez bramy CI

**Plik:** `.github/workflows/release.yml`

Workflow uruchamiany przy push tagu może:
1. Zostać wywołany bez przejścia przez CI na `main` (tagi można tworzyć ręcznie z dowolnego commitu)
2. Opublikować pakiet z podatnościami, bo brak `npm audit --audit-level=high` przed publikacją (jest tylko w CI, nie w release)

**Naprawa:**
```yaml
# Dodać przed npm publish w release.yml:
- run: npm audit --audit-level=high

# Opcjonalnie — środowisko z wymaganymi approvals:
environment: npm
```

---

#### MEDIUM-2: GitHub Actions bez SHA pinning — ryzyko supply chain

**Pliki:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`

```yaml
uses: actions/checkout@v4           # tagi mogą być przestawione
uses: actions/setup-node@v4
uses: softprops/action-gh-release@v2
```

Dla pipeline publikującego na npm (z `NODE_AUTH_TOKEN`), SHA pinning to standard bezpieczeństwa.

**Naprawa:**
```yaml
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683         # v4.2.2
uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af       # v4.1.0
uses: softprops/action-gh-release@c062e08bd532815e2082a85e87e3ef29c3e6d191  # v2
```

Dependabot przy konfiguracji `package-ecosystem: github-actions` będzie automatycznie aktualizował SHA.

---

#### MEDIUM-3: Brakujące keywords na npm — ograniczona discoveryability

**Plik:** `package.json:8–14`

Aktualne: `["homebridge-plugin", "homebridge", "xiaomi", "air-purifier", "homekit"]`

Brakuje: `"mi"`, `"miio"`, `"miot"`, `"pm2.5"`, `"air-quality"`, `"purifier"`, `"smart-home"`, `"iot"`, `"zhimi"`

**Naprawa:**
```json
"keywords": [
  "homebridge-plugin",
  "homebridge",
  "homekit",
  "xiaomi",
  "mi",
  "miio",
  "miot",
  "air-purifier",
  "purifier",
  "air-quality",
  "pm2.5",
  "smart-home",
  "iot",
  "zhimi"
],
```

---

#### MEDIUM-4: `author` — niepełny format w package.json

**Plik:** `package.json:61`

```json
"author": "TaKeN"
```

Standardowy format npm umożliwiający linkowanie profilu:
```json
"author": {
  "name": "TaKeN",
  "url": "https://github.com/takenek"
}
```

---

#### MEDIUM-5: Trzy kanały pollingu wykonują identyczną pracę

**Plik:** `src/core/device-client.ts:143–149`

```typescript
private safePoll(channel: "operation" | "sensor" | "keepalive"): void {
  void this.enqueueOperation(async () => {
    await this.pollWithRetry();  // ZAWSZE czyta wszystkie właściwości z urządzenia
  })
```

Wszystkie trzy kanały (operation 10s, sensor 30s, keepalive 60s) wywołują tę samą `pollWithRetry()`, która czyta wszystkie dane. Nazwy sugerują zróżnicowanie (szybkie kontrolne vs wolnozmienne sensory vs podtrzymanie sesji), ale różnią się tylko interwałem — nie zakresem.

Powiązane z CRITICAL-4 — dopiero gdy `getProperties` będzie przyjmował i używał parametru `props`, zróżnicowanie kanałów nabierze sensu.

---

#### MEDIUM-6: Shutdown może czekać do `operationTimeoutMs` na aktywne UDP wywołanie

**Plik:** `src/core/device-client.ts:89–93`, `src/core/miio-transport.ts:580–646`

`clearTimers()` przerywa retry delay, ale jeśli UDP `sendAndReceive` jest w trakcie wykonania (oczekuje na odpowiedź lub timeout), zamknięcie socketu wyrzuci błąd lub zablokuje shutdown na `operationTimeoutMs` (domyślnie 15 sekund).

**Naprawa:** W `sendAndReceive`, sprawdzać `socketClosed` flag i od razu odrzucać promise przy zamkniętym gnieździe:
```typescript
this.socket.on("message", onMessage);
this.socket.once("error", onError);

// Dodać: natychmiastowe odrzucenie przy zamkniętym sockecie
if (this.socketClosed) {
  cleanup();
  reject(new Error("Socket closed"));
  return;
}
```

---

### Priorytet LOW

#### LOW-1: `tsconfig.json` — vitest/globals dostępne w kodzie produkcyjnym

**Plik:** `tsconfig.json:15`

```json
"types": ["node", "vitest/globals"]
```

Włączenie `vitest/globals` w głównym tsconfig powoduje, że `describe`, `it`, `expect`, `vi` są typowo dostępne w kodzie `src/` (kompilator nie zaprotestuje przy przypadkowym użyciu). Lepiej osobna konfiguracja:

**Naprawa — `tsconfig.json` (produkcja):**
```json
{
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "test"]
}
```

**Nowy `tsconfig.test.json`:**
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"]
}
```

---

#### LOW-2: Brakujące `"description"` dla pól opcjonalnych w `config.schema.json`

**Plik:** `config.schema.json`

Pole `exposeFilterReplaceAlertSensor` i kilka timeout fields nie ma `"description"` wyjaśniającego semantykę. Homebridge Config UI X wyświetla te opisy jako tooltip — warto je dodać dla UX.

---

#### LOW-3: `biome.json` — brak dodatkowych reguł jakości

**Plik:** `biome.json`

`recommended: true` obejmuje podstawowy zestaw. Warto rozważyć:
```json
{
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "complexity": {
        "noExcessiveCognitiveComplexity": "warn"
      }
    }
  }
}
```

---

## 4. Sugestie zmian w plikach — propozycje konkretne

### 4.1 `package.json` — kompletna propozycja

```json
{
  "name": "homebridge-xiaomi-air-purifier-modern",
  "version": "1.0.0",
  "type": "commonjs",
  "description": "Modern Homebridge plugin for Xiaomi Mi Air Purifier (2H/3/3H/4/Pro) — no external dependencies",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": [
    "homebridge-plugin",
    "homebridge",
    "homekit",
    "xiaomi",
    "mi",
    "miio",
    "miot",
    "air-purifier",
    "purifier",
    "air-quality",
    "pm2.5",
    "smart-home",
    "iot",
    "zhimi"
  ],
  "engines": {
    "node": "^20.0.0 || ^22.0.0 || ^24.0.0",
    "homebridge": "^1.11.1 || ^2.0.0"
  },
  "homepage": "https://github.com/takenek/xiaomi-mi-air-purifier-ng",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/takenek/xiaomi-mi-air-purifier-ng.git"
  },
  "bugs": {
    "url": "https://github.com/takenek/xiaomi-mi-air-purifier-ng/issues"
  },
  "license": "MIT",
  "author": {
    "name": "TaKeN",
    "url": "https://github.com/takenek"
  },
  "files": [
    "dist",
    "config.schema.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "check": "npm run lint && npm run typecheck && npm test && npm run build",
    "prepare": "npm run build",
    "prepack": "npm run build",
    "release:patch": "npm version patch && git push --follow-tags",
    "release:minor": "npm version minor && git push --follow-tags",
    "release:major": "npm version major && git push --follow-tags"
  },
  "peerDependencies": {
    "homebridge": "^1.11.1 || ^2.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.4",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^4.0.0",
    "homebridge": "^1.11.1",
    "typescript": "^5.8.2",
    "vitest": "^4.0.0"
  }
}
```

**Kluczowe zmiany względem oryginału:**
- `@types/node: "^22.0.0"` (zgodne z obsługiwanymi Node 20–24)
- `author` jako obiekt z `url`
- `CONTRIBUTING.md` usunięte z `files`
- Rozszerzone `keywords` (13 słów kluczowych zamiast 5)
- `engines.homebridge` bez suffix `-beta.0`

---

### 4.2 `.github/workflows/release.yml` — z `npm audit` i SHA pinning

```yaml
name: release

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: 22
          cache: npm
          registry-url: https://registry.npmjs.org

      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm test
      - run: npm run build

      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@c062e08bd532815e2082a85e87e3ef29c3e6d191  # v2
        with:
          generate_release_notes: true
```

---

### 4.3 `.github/workflows/ci.yml` — z SHA pinning

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  audit:
    name: ci / audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high

  lint:
    name: ci / lint (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run lint

  typecheck:
    name: ci / typecheck (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  test:
    name: ci / test (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-node-${{ matrix.node-version }}
          path: coverage

  build:
    name: ci / build (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af  # v4.1.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm pack --dry-run
      - uses: actions/upload-artifact@v4
        with:
          name: package-node-${{ matrix.node-version }}
          path: dist
```

---

### 4.4 `tsconfig.json` — usunąć `vitest/globals`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "test"]
}
```

**Nowy `tsconfig.test.json`:**
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"],
  "exclude": ["dist", "node_modules"]
}
```

---

## 5. Ocena zgodności ze standardami Homebridge

### Homebridge 1.x — **7.5/10**

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja pluginu (`registerAccessory`) | ✅ 10/10 | Poprawna, PLUGIN_NAME/ACCESSORY_NAME spójne |
| `config.schema.json` (`pluginAlias` + layout) | ✅ 10/10 | Zgodny, dobry layout dla Config UI X |
| Obsługa shutdown (`api.on("shutdown")`) | ✅ 10/10 | Prawidłowe czyszczenie timerów i zamknięcie socketu |
| Obsługa błędów połączenia i retry | ✅ 9/10 | Exponential backoff z jitter, connection events |
| `AccessoryPlugin` interfejs | ✅ 9/10 | `getServices()` zwraca `Service[]` — poprawnie |
| Logowanie (debug/info/warn/error) | ✅ 9/10 | Poprawne użycie Homebridge `Logging` |
| `ConfiguredName` compatibility fallback | ✅ 9/10 | Działa na starszym i nowszym HB |
| `FilterMaintenance` service | ✅ 8/10 | Poprawnie skonfigurowany, alert opcjonalny |
| Mapowanie AQI → HomeKit AirQuality | ✅ 8/10 | GB3095-2012 — prawidłowy standard PM2.5 |
| Walidacja konfiguracji | ✅ 9/10 | Token hex, pola wymagane, normalizacja wartości |
| Brak `Service.AirPurifier` | ❌ 0/10 | Krytyczne — brak natywnego serwisu HAP |
| Fan speed nie eksponowane | ❌ 0/10 | `RotationSpeed` zaimplementowane ale martwe |
| `ContactSensorState` bug | ❌ 0/10 | Błędna logika — odwrócony alert filtra |
| `SerialNumber` unikalność | ⚠️ 5/10 | "unknown" — nieunikalny przy multi-device |

### Homebridge 2.x — **7/10**

- `peerDependencies` obejmują `^2.0.0-beta.0` ✅
- Brak Homebridge 2.x w `devDependencies` — testy tylko na 1.x ⚠️
- `AccessoryPlugin` API istnieje w obu wersjach ✅
- `engines.homebridge` deklaruje 2.x ✅
- Nie potwierdzono testami na Homebridge 2.x final ⚠️

---

## 6. Checklista „gotowe do npm"

### Dokumentacja i pliki projektowe
- [x] `LICENSE` (MIT, 2026)
- [x] `README.md` z instalacją, konfiguracją, przykładami i troubleshooting
- [x] `CHANGELOG.md` z historią wersji
- [x] `CONTRIBUTING.md` z procesem PR i conventional commits
- [x] `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- [x] `SECURITY.md` z polityką zgłaszania podatności i 7-dniowym terminem
- [x] Templates issue — bug report, feature request, config
- [ ] Template Pull Request (brak `.github/pull_request_template.md`)
- [x] `RELEASE_CHECKLIST.md`
- [x] `docs/reliability-testing.md`

### Konfiguracja TypeScript / Linter / Formatter
- [x] `tsconfig.json` ze strict mode (`noImplicitAny`, `noUncheckedIndexedAccess`, etc.)
- [ ] Osobna konfiguracja `tsconfig.test.json` (vitest globals nie powinny być w głównym tsconfig)
- [x] `biome.json` (linter + formatter)
- [x] `.editorconfig`
- [x] `.gitignore`

### package.json — pola wymagane
- [x] `name` z prefiksem `homebridge-`
- [x] `version` semantyczna (1.0.0)
- [x] `description`
- [ ] `author` jako obiekt z `url` (aktualnie tylko string "TaKeN")
- [x] `license: "MIT"`
- [x] `homepage`, `repository`, `bugs`
- [ ] `keywords` — brakuje: mi, miio, miot, pm2.5, air-quality, purifier, smart-home, iot, zhimi
- [x] `main`, `types` wskazują na `dist/`
- [x] `files` lista z explicytnymi plikami
- [ ] `CONTRIBUTING.md` w `files` — niepotrzebne, powinno być usunięte
- [x] `engines` (Node 20/22/24, Homebridge 1.x/2.x)
- [x] `peerDependencies` (homebridge)
- [ ] `@types/node@^25` niezgodne z `engines.node` (max Node 24)
- [x] `engine-strict=true` w `.npmrc`

### Build i publikacja
- [x] Build output w `dist/` (TypeScript → CommonJS)
- [x] Declaration files (`.d.ts`) generowane
- [x] `npm pack --dry-run` w CI
- [x] `prepack: npm run build` (auto-build przed publish)
- [x] npm provenance (`--provenance`) w release workflow
- [ ] `npm audit --audit-level=high` w release workflow (brak)
- [ ] SHA-pinned GitHub Actions (ryzyko supply chain)

### Testy i CI
- [x] Testy jednostkowe i integracyjne (vitest)
- [x] 100% coverage statements/branches/functions/lines (z wyłączeniem warstwy UDP)
- [x] Lint w CI (Biome)
- [x] Typecheck w CI (tsc --noEmit)
- [x] Build w CI
- [x] Audit w CI (`npm audit --audit-level=high`)
- [x] Macierz Node 20/22/24
- [x] Dependabot (npm + GitHub Actions)
- [ ] SHA pinning Actions (Dependabot aktualizuje wersje tagów, nie SHA)
- [ ] Test na Homebridge 2.x (tylko 1.x w devDeps)
- [ ] PR template

### Homebridge-specific
- [x] `config.schema.json` z poprawnym `pluginAlias: "XiaomiMiAirPurifier"`
- [x] `pluginType: "accessory"` (poprawny dla single-device plugins)
- [x] Walidacja konfiguracji (token 32-char hex, required fields, range checks)
- [ ] **`Service.AirPurifier`** zamiast `Service.Switch` dla zasilania ← CRITICAL
- [ ] **`RotationSpeed`** eksponowane do HomeKit ← CRITICAL (martwy kod)
- [ ] **`ContactSensorState`** — poprawna logika alertu filtra ← CRITICAL (bug produkcyjny)
- [ ] `SerialNumber` unikalny (np. hash z adresu)
- [x] Obsługa shutdown event
- [x] Retry z exponential backoff i jitter
- [x] Serialna kolejka operacji (brak race conditions)

### Wersjonowanie
- [x] Semantic Versioning (SemVer)
- [x] Wersja w CHANGELOG
- [x] Scripts `release:patch/minor/major`
- [ ] Conventional Commits nie są wymuszone automatycznie (brak commitlint/husky)
- [ ] Brak `semantic-release` — ręczne wersjonowanie

---

## 7. Tabela priorytetów

| ID | Priorytet | Problem | Wysiłek szacunkowy |
|----|-----------|---------|-------------------|
| CRITICAL-1 | 🔴 Bloker | ContactSensorState logika odwrócona (bug produkcyjny) | XS (~1h) |
| CRITICAL-2 | 🔴 Bloker | Fan speed nie eksponowane do HomeKit — martwy kod | S (~4h) |
| CRITICAL-3 | 🔴 Bloker | Brak natywnego Service.AirPurifier | L (~2-3d) |
| CRITICAL-4 | 🔴 Bloker | getProperties ignoruje `props` — misleading API | S (~2h) |
| HIGH-1 | 🟠 High | Legacy: 13 sekwencyjnych UDP calls zamiast batch | M (~4h) |
| HIGH-2 | 🟠 High | @types/node@^25 vs engines Node 20-24 | XS (~5min) |
| HIGH-3 | 🟠 High | SerialNumber "unknown" — nieunikalny | XS (~15min) |
| HIGH-4 | 🟠 High | CONTRIBUTING.md w `files` npm | XS (~2min) |
| HIGH-5 | 🟠 High | LED mapping: MIOT (numeric) vs Legacy (string) niespójność | S (~2h) |
| HIGH-6 | 🟠 High | reconnectDelayMs semantyka vs rzeczywisty efekt | S (~2h) |
| MEDIUM-1 | 🟡 Medium | npm audit w release workflow | XS (~15min) |
| MEDIUM-2 | 🟡 Medium | SHA pinning GitHub Actions | S (~1h) |
| MEDIUM-3 | 🟡 Medium | Brakujące keywords npm | XS (~5min) |
| MEDIUM-4 | 🟡 Medium | author jako obiekt | XS (~2min) |
| MEDIUM-5 | 🟡 Medium | Trzy kanały pollingu = identyczna praca | M (~4h) |
| MEDIUM-6 | 🟡 Medium | Shutdown czeka do operationTimeoutMs | M (~4h) |
| LOW-1 | 🟢 Low | Osobny tsconfig.test.json | XS (~30min) |
| LOW-2 | 🟢 Low | Descriptions w config.schema.json | XS (~30min) |
| LOW-3 | 🟢 Low | Biome — dodatkowe reguły | XS (~15min) |

---

*Raport wygenerowany przez Claude (Anthropic) w wyniku pełnego, niezależnego code review całego repozytorium — źródła, testy, CI/CD, dokumentacja, konfiguracja. Każde znalezisko zostało zweryfikowane przez bezpośrednią analizę kodu.*
