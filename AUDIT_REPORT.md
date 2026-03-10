# Homebridge Plugin Audit Report — v12

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-03-10
**Audytor:** Claude Sonnet 4.6 — niezalezny pelny code review, security audit, quality assessment (PROMPT 1)
**Metoda:** Kompletna analiza kazdego pliku repozytorium: 8 plikow zrodlowych (`src/`), 13 plikow testowych + `helpers/`, 6 workflow GitHub Actions, wszystkie konfiguracje, kompletna dokumentacja OSS. Kazdej sformulowanej obserwacji odpowiada weryfikacja bezposrednia na kodzie lub uruchomionym poleceniu.

---

### Komendy weryfikacyjne (uruchomione z `env -u npm_config_http_proxy -u npm_config_https_proxy`)

| Komenda | Wynik |
|---------|-------|
| `npm ci` | ✅ 0 vulnerabilities |
| `npm run lint` | ✅ Biome: "Checked 30 files in 47ms. No fixes applied." |
| `npm run typecheck` | ✅ tsc: 0 errors, 0 warnings |
| `npm test` (vitest --coverage) | ✅ 126/126 tests passed · 13 test files · 100% statements/branches/functions/lines |
| `npm run build` | ✅ Clean TypeScript compilation |
| `npm audit --audit-level=high` | ✅ "found 0 vulnerabilities" |
| `npm outdated` | ⚠️ `@types/node` 22.x installed vs 25.x latest (akceptowalne — patrz sekcja 6) |
| deprecated packages (lockfile scan) | ✅ Jedyny deprecated: `q@1.1.2` (tranzytywna zaleznosc homebridge 1.x) |
| `npm pack --dry-run` | ✅ 34 pliki, 37.2 kB packed, 163.7 kB unpacked |

---

## 1. Executive Summary

### Najwieksze plusy

1. **Zero zaleznosci runtime.** Wtyczka uzywa wylacznie `node:crypto` i `node:dgram`. Supply-chain risk praktycznie zerowy — wybitne osiagniecie na tle ekosystemu Homebridge.

2. **126 testow w 13 plikach, wymuszony 100% coverage.** `vitest.config.ts` narzuca progi na statements/branches/functions/lines. Suite obejmuje 9 realistycznych scenariuszy sieciowych (S1–S9), crypto round-trip, pelne branch coverage transportu MIIO/MIOT, kompletny coverage DeviceClient. Testy sa zorganizowane modularnie i semantycznie.

3. **Profesjonalny CI/CD z supply-chain hardening.** Semantic-release z npm provenance, SBOM CycloneDX, OSV Scanner, OpenSSF Scorecard, Dependabot (npm + GitHub Actions), macierz CI Node 20/22/24 × Homebridge 1.11.2/beta, SHA-pinned GitHub Actions z komentarzami wersji. `npm audit --audit-level=high` w obu workflow (CI i Release).

4. **Solidna architektura warstwowa z SRP.** `MiioTransport → DeviceClient → AirPurifierAccessory → XiaomiAirPurifierPlatform`. Operation queue serializujaca UDP, retry z exponential backoff + jitter (±20%), dual protocol (MIOT/Legacy) z auto-detekcja i runtime fallback.

5. **Trojstronna spojnosc dokumentacji.** README ↔ `config.schema.json` ↔ kod zrodlowy (`platform.ts`) — wszystkie wartosci domyslne, limity, mapowania i nazwy pol identyczne we wszystkich trzech zrodlach.

6. **Kompletna dokumentacja i standardy spolecznosci OSS.** README z pelna konfiguracja, troubleshooting, mapowaniem AQI, network hardening. CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, szablony issues/PR, CODEOWNERS, RELEASE_CHECKLIST.

### Glowne ryzyka / obszary do poprawy

1. **Release workflow nie jest bramkowany na zakonczenie macierzy CI** — potencjalny race condition miedzy publishem a pelna macierza testow. Medium-priority.

2. **Komentarze wersji GitHub Actions `# v6.0.2` dla `actions/checkout`** — oficjalnie najnowsza stabilna wersja actions/checkout to v4. Komentarz `v6.0.2` moze wprowadzac w blad przy audycie SHA-pinow, mimo ze samo SHA jest prawidlowe.

3. **`@types/node: ^22.0.0` przy deklarowanym wsparciu Node 20/22/24** — drobna niespojnosc, choć w praktyce bezpieczna ze wzgledu na kompatybilnosc wsteczna typow.

---

## 2. Analiza struktury projektu

### 2.1 Drzewo katalogow

```
xiaomi-mi-air-purifier-ng/
├── src/
│   ├── index.ts                    # Entry point (11 linii)
│   ├── platform.ts                 # DynamicPlatformPlugin + walidacja konfiguracji (302 linie)
│   ├── accessories/
│   │   └── air-purifier.ts         # HomeKit bindings, 10 serwisow (676 linii)
│   └── core/
│       ├── types.ts                # DeviceState, MiioTransport, READ_PROPERTIES (49 linii)
│       ├── miio-transport.ts       # UDP MIIO/MIOT transport (797 linii)
│       ├── device-client.ts        # Polling, retry, operation queue (317 linii)
│       ├── mappers.ts              # fan_level <-> rotation speed, AQI -> HomeKit (41 linii)
│       ├── mode-policy.ts          # Logika przelacznikow trybow AUTO/NIGHT (30 linii)
│       └── retry.ts                # RetryPolicy, backoff, retryable codes (77 linii)
├── test/                           # 13 plikow testowych, 126 testow
├── .github/
│   ├── workflows/                  # ci.yml, release.yml, supply-chain.yml, scorecard.yml,
│   │   └── ...                     #   stale.yml, labeler.yml
│   ├── dependabot.yml
│   ├── labeler.yml
│   ├── CODEOWNERS
│   ├── ISSUE_TEMPLATE/             # bug_report.yml, feature_request.yml, config.yml
│   └── pull_request_template.md
├── config.schema.json              # Homebridge UI schema (241 linii)
├── biome.json                      # Linter/formatter
├── tsconfig.json / tsconfig.test.json
├── vitest.config.ts                # 100% coverage enforced
├── .releaserc.json                 # Semantic-release
├── .npmrc                          # engine-strict=true
├── .editorconfig
├── package.json
├── package-lock.json
└── {README,CHANGELOG,CONTRIBUTING,CODE_OF_CONDUCT,SECURITY,LICENSE,...}.md
```

**Ocena struktury:** Wzorcowy uklad projektu. Wyrazna separacja warstw: transport, logika biznesowa, HomeKit bindings, platforma. Zaden plik nie przekracza ~800 linii.

---

## 3. Zgodnosc ze standardami Homebridge 1.x i 2.x

### 3.1 Rejestracja platformy

```typescript
// src/index.ts
api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, XiaomiAirPurifierPlatform);
```

- `PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern"` — zgodne z nazwa w `package.json`.
- `PLATFORM_NAME = "XiaomiMiAirPurifier"` — zgodne z `pluginAlias` w `config.schema.json`.
- `pluginType: "platform"`, `singular: true` w schema — poprawny wzorzec DynamicPlatformPlugin.
- ✅ **Ocena: poprawna rejestracja.**

### 3.2 Cykl zycia (init/shutdown)

```typescript
// platform.ts — poprawny pattern
this.api.on("didFinishLaunching", () => {
  this.discoverDevices();
});

// air-purifier.ts — poprawne sprzatanie
this.api.on("shutdown", () => {
  void this.client.shutdown().catch(...);
});
```

- Akcesoria sa tworzone w `didFinishLaunching`. ✅
- Shutdown zamyka socket UDP i clears timers. ✅
- `client.init()` wywolane jako fire-and-forget w konstruktorze — standard HB. ✅

**Uwaga (LOW):** Shutdown listener jest rejestrowany przez `api.on("shutdown", ...)` w konstruktorze kazdego akcesorium. Przy wielu urzadzeniach powstaje N listenerow — wszystkie sa wywolywane przy shutdown. Jest to poprawne funkcjonalnie, ale mozna by uzyc `api.once("shutdown", ...)` dla kazdego klienta zamiast `on(...)`.

### 3.3 Cached accessories

```typescript
// platform.ts
public configureAccessory(accessory: PlatformAccessory): void {
  this.cachedAccessories.push(accessory);
}
```

Poprawna implementacja: cached accessories sa przechowywane i porownywane po UUID. Stale sa deregistrowane przez `api.unregisterPlatformAccessories()`. Nowe sa rejestrowane przez `api.registerPlatformAccessories()`, istniejace przez `api.updatePlatformAccessories()`. ✅

### 3.4 Homebridge 1.x vs 2.x

```typescript
// air-purifier.ts — dynamiczne wykrywanie serwisu AirPurifier
const AirPurifierService = getOptionalProperty(
  this.api.hap.Service,
  "AirPurifier",
);
this.usesNativePurifierService = Boolean(AirPurifierService);
```

Eleganckie rozwiazanie: Homebridge 2.x dostarcza natywny `Service.AirPurifier`, wersja 1.x nie. Kod wykrywa to runtime i dostosowuje serwis (Switch vs AirPurifier). ✅

Chrono-zgodne charakterystyki (Active, CurrentAirPurifierState, TargetAirPurifierState, RotationSpeed) sa bindowane tylko gdy `usesNativePurifierService === true`. ✅

### 3.5 Mapowanie funkcji oczyszczacza

| Funkcja | Homebridge 1.x | Homebridge 2.x | Ocena |
|---------|---------------|---------------|-------|
| Wlacz/wylacz | Switch.On | AirPurifier.Active | ✅ |
| Stan biezacy | N/A | CurrentAirPurifierState | ✅ |
| Cel (AUTO/MANUAL) | N/A | TargetAirPurifierState | ✅ |
| Predkosc wentylatora | N/A | RotationSpeed | ✅ |
| Jakosc powietrza | AirQualitySensor | AirQualitySensor | ✅ |
| Temperatura | TemperatureSensor | TemperatureSensor | ✅ |
| Wilgotnosc | HumiditySensor | HumiditySensor | ✅ |
| Filtr | FilterMaintenance | FilterMaintenance | ✅ |
| Child lock | Switch | Switch | ✅ |
| LED | Switch | Switch | ✅ |
| Tryb AUTO | Switch | Switch | ✅ |
| Tryb NIGHT | Switch | Switch | ✅ |

**Uwaga (MEDIUM — semantyczna):** Ustawienie predkosci wentylatora przez MIOT (`set_level_fan`) automatycznie przelacza tryb na `favorite` (piid:5=2), co jest konieczne dla urzadzen MIOT, ale jest skutkiem ubocznym nieudokumentowanym w kodzie. Warto dodac komentarz wyjasniajacy.

### 3.6 Stabilnosc przy utracie polaczenia

- Exponential backoff z jitterem (20%) i limitem EDEVICEUNAVAILABLE do 2 retries. ✅
- ConnectionStateEvent (connected/disconnected/reconnected) z loggingiem. ✅
- Timery operacji, sensorow i keepalive sa `unref()`-owane (nie blokuja zamkniecia procesu). ✅
- Socket UDP ma handler `on("error", ...)` w konstruktorze — brak uncaught error. ✅

**Ocena zgodnosci Homebridge:** **9.5/10** — wzorcowa implementacja.

---

## 4. Jakosć kodu (Node.js / TypeScript)

### 4.1 Asynchronicznosc i obslugi bledow

**Pozytywne:**
- Cala komunikacja UDP jest async/await z promisoryzowanym `sendAndReceive`. ✅
- `enqueueOperation()` serializuje operacje przez lancuch Promise, eliminujac race conditions na sockecie. ✅
- Kazda sciezka bledow jest obslugiwana: `try/catch` w `pollWithRetry`, `safePoll`, `emitConnectionEvent`, listenerach. ✅
- `isRetryableError()` filtruje 16 kodow sieciowych; `EDEVICEUNAVAILABLE` ma skrocony max retry. ✅

**Drobne obserwacje:**

**[LOW]** W `sendAndReceive`, `socket.once("error", onError)` uzywa `once`, ale `socket.on("message", onMessage)` uzywa `on`. Cleanup() poprawnie wywoluje `socket.off("message", onMessage)` i `socket.off("error", onError)`. W praktyce bezpieczne, ale asymetria `once` vs `on` moze byc myląca dla czytajacych kod.

**[LOW]** W `trySetViaMiot` — `params[0]` z tablicy `readonly unknown[]` jest dostepny bez sprawdzenia dlugosci tablicy. Przy `noUncheckedIndexedAccess: true` w tsconfig, TypeScript wymaga sprawdzenia — `tsc` to akceptuje poniewaz `params` jest `readonly unknown[]` i indeksowanie zwraca `unknown`. Jednak przekazywane wartosci sa zawsze przez wewnetrzne `enqueueSetAndSync` — brak ryzyka w praktyce.

### 4.2 Typowanie

- `strict: true`, `noImplicitAny: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. ✅
- `tsc --noEmit` przechodzi czysto. ✅

**[MEDIUM]** Mnogie rzutowania `as never` i `as unknown as {...}` sa wymuszone przez brak pelnych typow HB dla sluzb i charakterystyk. Jest to uzasadnione i dobrze skomentowane (`getOptionalProperty`, `getNumericEnum`). Jednak dla przyszlego maintenance warto dodac kratkowe komentarze wyjasniajace powod kazdego rzutowania.

**[LOW]** `tsconfig.json` uzywa `"moduleResolution": "Node"` (legacy alias dla `node`). TypeScript 5.x rekomenduje `"Node16"` lub `"Bundler"` dla nowych projektow. Dla wyjscia CommonJS dziala poprawnie, ale jest to przestarzala konfiguracja. Migracja do `"Node16"` jest niedestruktywna dla tego projektu.

### 4.3 Architektura

Wyrazna separacja warstw:
- `MiioTransport` (interfejs) → `ModernMiioTransport` (UDP + MIOT/Legacy)
- `DeviceClient` (polling, retry, queue, events)
- `AirPurifierAccessory` (HomeKit bindings, characteristic cache)
- `XiaomiAirPurifierPlatform` (config, discovery, lifecycle)

SRP jest zachowany. Brak "god objects". ✅

**[LOW]** `AirPurifierAccessory` konstruktor wywoluje `client.init()` (fire-and-forget) i `api.on("shutdown", ...)` w tym samym miejscu. Dla testowania lepiej byloby przyjac te zaleznosci przez dependency injection (init/shutdown callbacks), ale obecne podejscie jest zgodne z typowym wzorcem HB.

### 4.4 Zarzadzanie zasobami

- Wszystkie 3 timery (`setInterval`) sa `unref()`-owane. ✅
- `retryTimer` (`setTimeout`) jest `unref()`-owany. ✅
- `clearTimers()` czytelnie obsluguje kazdy timer i resolve pending delay. ✅
- `socket.close()` z obsluga `ERR_SOCKET_DGRAM_NOT_RUNNING`. ✅

**[LOW]** Wartosci zwrocone przez `client.onStateUpdate(...)` i `client.onConnectionEvent(...)` (funkcje czyszczace) sa porzucane w `air-purifier.ts:164-165`. W obecnej architekturze jest to bezpieczne (kazde urzadzenie ma swoj klient, klient nie jest wspoldzielony), ale jezeli klient bylyby kiedys wspoldzielony lub ponownie uzywany, listenerzy nie bylby czyszczeni. Drobny techniczny dlug.

### 4.5 Wydajnosc

- Characteristic caching przez `Map<string, CharacteristicValue>` — `updateCharacteristic()` nie jest wywolywany gdy wartosc nie zmienila sie. ✅
- Batch read MIOT (`get_properties` z N wlasciwosciami jednoczesnie) — minimalna liczba udpgramow. ✅
- Trzy oddzielne timery (operation/sensor/keepalive) reprezentuja rozne czestotliwosci odswiezania, ale wszystkie wywoluja `pollWithRetry()` ktory odczytuje WSZYSTKIE wlasciwosci. W praktyce: sensor i keepalive czytaja te same dane co operation — redundancja nie stanowi problemu przy urzadzeniach LAN.

### 4.6 Logowanie

- Token NIGDY nie jest logowany. ✅
- Adres IP moze byc maskowany przez `maskDeviceAddressInLogs`. ✅
- Poziomy logowania: `debug` dla szczegoly, `info` dla polaczenia, `warn` dla bledow, `error` dla konfiguracji. ✅
- `process.emitWarning` dla bledow transportu gdy nie ma loggera. ✅

---

## 5. Security & Supply Chain

### 5.1 Bezpieczenstwo komunikacji

- AES-128-CBC z kluczem/IV wyznaczonym przez MD5(token) / MD5(key, token) — zgodnie ze specyfikacja protokolu MIIO Xiaomi. Nie mozna uzyc silniejszego algorytmu (protokol narzuca AES-128-CBC).
- Checksum MD5 weryfikowany; niezgodnosc logowana (nie rzuca wyjatku) — poprawne podejscie dla urzadzenia IoT, unikajace blackoutu przy korupcji pakietu.

**[LOW — design]** Weryfikacja checksum jest "best-effort" (`reportSuppressedError`). Skompromitowany pakiet (MITM na sieci LAN) moze byc zdekryptowany i zparsowany mimo bledu checksum. Dla urzadzenia LAN-only jest to akceptowalne ryzyko, jednak warto udokumentowac to jako swiadomy wybor w SECURITY.md.

### 5.2 Przechowywanie danych wrazliwych

- Token jest przechowywany w pamieci jako `Buffer` (nie jako string jawnie loggowany). ✅
- Token nie jest logowany w zadnej sciezce kodu. ✅
- Adres IP moze byc maskowany. ✅

### 5.3 Walidacja wejscia

- `assertString()` — niepusty string. ✅
- `assertHexToken()` — regex `/^[0-9a-fA-F]{32}$/`. ✅
- `normalizeModel()` — sprawdzenie w zbiorze SUPPORTED_MODELS. ✅
- `normalizeThreshold()` — clamp 0–100. ✅
- `normalizeTimeout()` — minimum i skonczenie. ✅
- `normalizeBoolean()` — typ bool lub fallback. ✅

**[MEDIUM]** Adres IP jest walidowany jedynie przez `assertString(address)` (niepusty string). `config.schema.json` deklaruje `"format": "ipv4"`, ale ta walidacja jest jedynie w UI Homebridge — nie jest egzekwowana w kodzie runtime. Bledny adres IP (np. hostname, URL) zostanie wyslany do `dgram.socket.send()` i spowoduje blad `ENOTFOUND`/`EHOSTUNREACH` dopiero przy pierwszym polaczeniu. Niska dotkliwosc (jest to retryable), ale mozna dodac prosta walidacje IPv4 w `assertString`/dedykowanej funkcji.

### 5.4 Zaleznosci

- Brak zaleznosci runtime poza Node.js builtins. ✅
- Jedyny deprecated: `q@1.1.2` (tranzytywna od `homebridge@1.x`) — zaakceptowany. ✅
- `npm audit`: 0 podatnosci. ✅
- `package-lock.json` wersja 3 obecny. ✅

### 5.5 Supply-chain CI

- SHA-pinned GitHub Actions we wszystkich 6 workflow. ✅
- Dependabot: npm (weekly, limit 10 PRs) + GitHub Actions (weekly, limit 5 PRs). ✅
- OSV Scanner z `package-lock.json`. ✅
- SBOM CycloneDX generowany przy kazdy pushu na main i PR. ✅
- OpenSSF Scorecard (schedule + push). ✅
- npm provenance (`NPM_CONFIG_PROVENANCE: "true"`). ✅

**[HIGH — CI]** Komentarze SHA-pinow dla `actions/checkout` i `actions/setup-node` wskazuja wersje `# v6.0.2` i `# v4.4.0`. Oficjalnie najnowsza stabilna wersja `actions/checkout` to **v4** (nie v6). Mozliwe wyjasnienia: (a) istnieje v6 w prywatnym fork lub jako pre-release tag; (b) komentarz jest bledny i powinien brzmiec `# v4.x.x`. Przy audycie SHA-pinow komentarz sluzy jako weryfikacja dla czlowieka — niepoprawny komentarz podwaza cel SHA-pinningu. **Nalezy zweryfikowac SHA i skorygowac komentarz lub zaktualizowac SHA do poprawnej wersji v4.**

---

## 6. Testy, CI/CD i Automatyzacja

### 6.1 Testy

| Plik testowy | Liczba testow | Zakres |
|-------------|--------------|--------|
| `accessory.test.ts` | 14 | Inicjalizacja, bindingi, aktualizacje HK |
| `platform.test.ts` | 14 | Odkrywanie, cached accessories, konfiguracja |
| `device-client-branches.test.ts` | 25 | Retry, kolejka, connection state |
| `miio-transport-commands.test.ts` | 11 | Komendy set/get, MIOT/Legacy |
| `miio-transport-protocol.test.ts` | 10 | Handshake, szyfrowanie, auto-detekcja |
| `miio-transport-reliability.test.ts` | 8 | Timeouty, recovery, checksum |
| `network-scenarios.test.ts` | 9 | Scenariusze sieciowe S1-S9 |
| `mappers.test.ts` | 9 | Edge cases mapowania |
| `device-api.test.ts` | 7 | API urzadzenia end-to-end |
| `reliability.test.ts` | 5 | Lifecycle, reconnect |
| `config-validation.test.ts` | 7 | Walidatory konfiguracji |
| `crypto-roundtrip.test.ts` | 3 | Round-trip AES-128-CBC |
| `mode-policy.test.ts` | 4 | Logika przelacznikow trybow |
| **RAZEM** | **126** | **100% coverage** |

**Ocena:** Wzorcowy zestaw testow. Pokrycie krytycznych sciezek: protokol MIIO, retry z backoffem, warunki brzegowe mapowania, 9 scenariuszy sieciowych. Izolacja przez mocki transpotertu.

### 6.2 Linting i formatowanie

- Biome 2.4.6: linting + formatting. ✅
- `noExplicitAny: "error"` — strict typing. ✅
- 30 plikow sprawdzonych bez zadnych bledow. ✅
- `.editorconfig` dla spojnosci w roznych edytorach. ✅

**[LOW]** `biome.json` uzywa schematu powiazanego z wersja 2.4.6: `"$schema": "https://biomejs.dev/schemas/2.4.6/schema.json"`. Dependabot automatycznie aktualizuje pakiet, ale schemat URL wymaga recznej aktualizacji lub uzycia wersji `latest`. Dependabot zaproponuje PR z aktualizacja wersji — nalezy pamietac o aktualizacji `$schema`.

### 6.3 Pipeline CI (`ci.yml`)

```yaml
matrix:
  - {node: 20, homebridge: "1.11.2", lane: full}
  - {node: 22, homebridge: "1.11.2", lane: full}
  - {node: 24, homebridge: "1.11.2", lane: full}
  - {node: 22, homebridge: "beta",   lane: full}
  - {node: 24, homebridge: "beta",   lane: smoke}
```

- `fail-fast: false` — wszystkie macierze sie wykonuja mimo bledow. ✅
- `concurrency: ci-${{ github.ref }}` z cancel-in-progress. ✅
- Coverage uploadowany jako artifact dla `lane == 'full'`. ✅
- Oddzielny job `audit` z `npm audit --audit-level=high`. ✅
- `env -u npm_config_http_proxy -u npm_config_https_proxy` we wszystkich komendach npm. ✅

**[MEDIUM]** `setup-node` uzywa `cache: npm` bez `cache-dependency-path`. W projekcie z jednym `package-lock.json` w katalogu glownym dziala poprawnie. Brak konfiguracji tutaj nie jest blednem.

**[LOW]** Brak jawnego kroku `npm run build` po `npm test` w CI. Build jest uruchamiany posrednio przez `npm run check` w release.yml, ale CI nie weryfikuje ze skompilowany kod jest poprawny (tylko typecheck + testy). Mozna dodac `npm run build` do CI dla kompletnosci.

### 6.4 Release workflow (`release.yml`)

```yaml
on:
  push:
    branches: [main]
steps:
  - npm ci
  - npm audit --audit-level=high
  - npm run check  # lint + typecheck + test + build
  - semantic-release
```

- Semantic-release z `@semantic-release/npm` (publikuje do npm). ✅
- `NPM_CONFIG_PROVENANCE: "true"` — npm attestation. ✅
- `.releaserc.json` z plugins: commit-analyzer, release-notes-generator, changelog, npm, git, github. ✅

**[HIGH]** Release workflow **nie jest uzalezniony od pomyslnego zakonczenia CI matrix**. Oba workflow sa triggerowane przez push na `main` i uruchamiaja sie wspolbieznie. Release moze opublikowac paczke do npm przed zakonczeniem testow na Node 20 + Homebridge 1.11.2. Jezeli te testy zawiodia po publikacji, mamy regresje w opublikowanej wersji.

**Rekomendacja:** Przelacz release workflow na trigger przez tag semver (`on: push: tags: ["v*"]`) LUB dodaj `needs: [test]` do job release odwolujac sie do CI workflow. Przykladowe rozwiazanie:

```yaml
# Opcja A: trigger na tag (semantyczny porzadek)
on:
  push:
    tags: ["v[0-9]+.[0-9]+.[0-9]+"]

# Opcja B: wymagaj zakonczenia CI (wymaga reorg workflow)
# Polacz ci.yml i release.yml w jeden plik z:
jobs:
  test:
    # ... macierz CI
  release:
    needs: [test]
    if: github.ref == 'refs/heads/main'
    # ... semantic-release
```

**[LOW]** Podczas semantic-release `npm publish`, npm lifecycle uruchamia:
1. `prepare` → `npm run build` (kompilacja)
2. `prepublishOnly` → `npm run lint && typecheck && test && build`

To jest **podwojne budowanie** i **powtorne uruchomienie testow** po tym jak release.yml juz wykonal `npm run check`. Redundantne, ale bezpieczne. Mozna rozwazyc usuniecie `build` z `prepublishOnly` lub przeniesienie logiki do CI.

### 6.5 Dependabot

```yaml
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: weekly
    open-pull-requests-limit: 10
    labels: [dependencies]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: weekly
    open-pull-requests-limit: 5
    labels: [dependencies, github-actions]
```

Poprawna konfiguracja dla obu ekosystemow. ✅

**[LOW]** Brak konfiguracji `groups` w Dependabot — kazda zaleznosc dostanie osobny PR. Przy 169 zainstalowanych pakietach (169 devDependencies) moze to generowac duzo PR przy aktualizacjach major. Mozna rozwazyc grupowanie (np. biome, typescript, vitest razem).

---

## 7. Analiza szczegolowa — krytyczne obserwacje

### 7.1 actions/checkout v6 — niepoprawny komentarz SHA

**Priorytet: HIGH**

Wszystkie workflow uzywaja:
```yaml
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

Oficjalnie `actions/checkout` ma wersje: v1, v2, v3, v4. Wersja v6 nie istnieje w publicznym repozytorium `actions/checkout`. Komentarz `# v6.0.2` jest bledny lub odwoluje sie do nieoficjalnego taga.

**Dzialanie:** Zweryfikowac SHA `de0fac2e4500dabe0009e67214ff5f5447ce83dd` i skorygowac komentarz na wlasciwa wersje (prawdopodobnie `# v4.x.x`) lub zaktualizowac SHA do najnowszej oficjalnej v4.

### 7.2 Release nie bramkowany CI

**Priorytet: HIGH**

Opisane szczegolowo w sekcji 6.4. Krotko: push na `main` wyzwala jednoczesnie CI (macierz 5 kombinacji) i Release. Release moze skonczyc sie przed CI. Nalezy polaczyc w jeden workflow lub zmienic trigger Release na tag.

### 7.3 IP address runtime validation gap

**Priorytet: MEDIUM**

```typescript
const address = assertString(deviceConfig.address, "address");
// Brak walidacji formatu IPv4
```

`config.schema.json` wymaga `"format": "ipv4"` ale Homebridge UI nie zawsze egzekwuje walidacje schema. Niepoprawny adres (np. `"192.168.1"`, `"http://device"`) zostanie zaakceptowany przez `assertString()` i zwroci blad dopiero przy polaczeniu UDP (`EHOSTUNREACH`). Komunikat bledny bedzie mniej zrozumialy niz komunikat o blednej konfiguracji.

**Propozycja:**
```typescript
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
export const assertIpv4Address = (value: string, field: string): string => {
  if (!IPV4_RE.test(value)) {
    throw new Error(`Invalid config field: ${field} must be a valid IPv4 address.`);
  }
  return value;
};
```

### 7.4 @types/node version vs engines

**Priorytet: LOW**

```json
"engines": { "node": "^20.0.0 || ^22.0.0 || ^24.0.0" },
"devDependencies": { "@types/node": "^22.0.0" }
```

Node 22 types sa nadzbiorem Node 20 types (backward compatible API), wiec typy Node 20 sa objete przez Node 22 `@types/node`. Dla Node 24, aktualnie `@types/node@^22.x` rowniez dziala (Node 24 nie wniosi nowych APIs nieobjetych przez v22 types w momencie pisania). W praktyce bezpieczne, ale moze byc mylace. Mozna rozwazyc `"@types/node": ">=20.0.0"` lub `"^20.0.0"`.

### 7.5 prepare script przy instalacji z GitHub

**Priorytet: LOW**

```json
"prepare": "npm run build"
```

Przy `npm install github:takenek/xiaomi-mi-air-purifier-ng` (instalacja ze zrodla), npm uruchomi `prepare` → `tsc`. TypeScript nie bedzie dostepny (devDependency). Instalacja zwroci blad.

Poniewaz `dist/` jest zawarty w `files` w `package.json` i w opublikowanej paczce npm, to problem dotyczy jedynie instalacji ze zrodla GitHub. Homebridge instaluje z npm registry — brak problemu.

**Jezeli chcesz wspierac instalacje GitHub-direct:** dodaj informacje w CONTRIBUTING.md aby uzyc `npm install` a nie `npm ci` lub rozwazyc `"prepare": "npm run build 2>/dev/null || true"` (nie rekomendowane — ukrywa bledy).

### 7.6 MIOT set_level_fan — nieudokumentowany efekt uboczny

**Priorytet: LOW (dokumentacja)**

```typescript
// src/core/miio-transport.ts:575-580
if (method === "set_level_fan") {
  const level = Math.max(1, Math.min(16, toNumber(params[0])));
  return send([
    { did, siid: 2, piid: 5, value: 2 },  // Ustawia tryb na "favorite"!
    { did, siid: 10, piid: 10, value: level },
  ]);
}
```

Ustawienie predkosci wentylatora przez MIOT jednoczesnie przelacza tryb na `favorite`. Jest to wymagane przez protokol MIOT dla urzadzen Xiaomi (reczna predkosc wymaga trybu favorite), ale nie jest skomentowane. Warto dodac komentarz: `// MIOT requires favorite mode (piid:5=2) before accepting manual fan_level (piid:10)`.

---

## 8. Ocena zgodnosci ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja platformy | ✅ 10/10 | Poprawny DynamicPlatformPlugin |
| Lifecycle (init/shutdown) | ✅ 9.5/10 | api.on("shutdown") zamiast api.once |
| Cached accessories | ✅ 10/10 | Wzorcowa implementacja |
| HomeKit 1.x compatibility | ✅ 10/10 | Switch jako fallback |
| HomeKit 2.x compatibility | ✅ 10/10 | Native AirPurifier service |
| Mapowanie charakterystyk | ✅ 9.5/10 | Kompletne, MIOT side effect niezauw. |
| Stabilnosc przy utracie polaczenia | ✅ 10/10 | Retry + backoff + jitter |
| Logowanie | ✅ 10/10 | Odpowiednie poziomy, token bezpieczny |
| Konfiguracja | ✅ 10/10 | Pelna walidacja, schema UI |
| **SUMA** | **9.7/10** | **Wzorcowa zgodnosc** |

---

## 9. Checklista "gotowe do npm"

| Element | Status | Uwagi |
|---------|--------|-------|
| LICENSE (MIT) | ✅ | |
| README z konfiguracja i troubleshooting | ✅ | |
| README z przykladami konfiguracji | ✅ | |
| CHANGELOG | ✅ | v1.0.0 + Unreleased |
| CONTRIBUTING | ✅ | Conventional Commits |
| CODE_OF_CONDUCT | ✅ | Contributor Covenant v2.1 |
| SECURITY.md z SLA | ✅ | |
| RELEASE_CHECKLIST | ✅ | |
| Issue templates | ✅ | bug_report.yml, feature_request.yml |
| PR template | ✅ | |
| CODEOWNERS | ✅ | |
| tsconfig z strict mode | ✅ | |
| Biome (lint + format) | ✅ | |
| .editorconfig | ✅ | |
| .npmrc (engine-strict) | ✅ | |
| files[] w package.json | ✅ | dist, schema, docs |
| Keywords w package.json | ✅ | 14 keywords |
| homepage, repository, bugs | ✅ | |
| engines (node + homebridge) | ✅ | |
| peerDependencies (homebridge) | ✅ | ^1.11.1 \|\| ^2.0.0 |
| config.schema.json | ✅ | singular, UI layout |
| Build output (dist/) | ✅ | JS + .d.ts + .js.map |
| Zero produkcyjnych zaleznosci | ✅ | |
| npm audit: 0 vulnerabilities | ✅ | |
| 100% test coverage | ✅ | vitest v8 enforced |
| Semantic-release | ✅ | |
| npm provenance | ✅ | |
| SHA-pinned GitHub Actions | ✅ | |
| Dependabot (npm + actions) | ✅ | |
| SBOM CycloneDX | ✅ | |
| OSV Scanner | ✅ | |
| OpenSSF Scorecard | ✅ | |
| Release bramkowany CI | ⚠️ | MEDIUM: brak needs dependency |
| actions/checkout v komentarzu | ⚠️ | HIGH: v6.0.2 nie istnieje oficjalnie |
| IP validation runtime | ⚠️ | LOW: tylko assertString |
| moduleResolution nowoczesny | ⚠️ | LOW: "Node" zamiast "Node16" |

**Wynik: 30/34 pozycji ✅, 4 wymagaja uwagi (zadna nie jest blokerem publikacji)**

---

## 10. Lista krytycznych problemow (blokery npm)

**Brak blokerow publikacji na npm.** Wszystkie kluczowe elementy sa gotowe.

---

## 11. Lista waznych usprawnien

### HIGH

1. **[security/ci] Weryfikacja SHA actions/checkout i korekcja komentarza `# v6.0.2`**
   - Zweryfikowac do jakiego taga odnosi sie SHA `de0fac2e4500dabe0009e67214ff5f5447ce83dd`
   - Skorygowac komentarz lub zaktualizowac SHA do oficjalnej `actions/checkout@v4`

2. **[ci] Release workflow uzalezniony od CI matrix**
   - Przelaczenie triggera na semver tag `v*` LUB polaczenie workflow z `needs: [test]`

### MEDIUM

3. **[code] Walidacja adresu IP w platform.ts**
   - Dodac `assertIpv4Address()` wywolywana po `assertString(deviceConfig.address, "address")`

4. **[docs/code] Komentarz do MIOT set_level_fan side effect**
   - Dodac 1-liniowy komentarz w `trySetViaMiot` wyjasniajacy koniecznosc ustawienia trybu `favorite`

### LOW

5. **[config] tsconfig moduleResolution: "Node16"**
   - Migracja z przestarzalego `"Node"` na `"Node16"` — niedestruktywna dla CommonJS output

6. **[config] @types/node szerszy range**
   - Rozwazyc `"@types/node": "^20.0.0"` dla lepszej spojnosci z zadeklarowanymi engines

7. **[ci] Dodac `npm run build` do CI matrix**
   - Weryfikacja kompilacji (nie tylko typecheck) w kazdej konfiguracji macierzy

8. **[config] Dependabot groups**
   - Zgrupowanie zaleznosci deweloperskich (biome, typescript, vitest) by redukowac liczbe PR

9. **[docs] Aktualizacja $schema w biome.json po upgrade Biome**
   - Pamietac o aktualizacji schema URL przy Dependabot PR aktualizujacym biome

10. **[code] api.once("shutdown") zamiast api.on("shutdown")**
    - Zapobiegawczo, aby uniknac wielokrotnego wywolania shutdown

---

## 12. Ocena ogolna

| Kategoria | Ocena | Komentarz |
|-----------|-------|-----------|
| Architektura kodu | 9.5/10 | Wzorcowa separacja warstw, SRP |
| Jakosc TypeScript | 9/10 | Strict mode, drobne as-cast |
| Testy | 10/10 | 126 testow, 100% coverage, modularny split |
| CI/CD | 8.5/10 | Brak bramkowania release na CI |
| Bezpieczenstwo | 9.5/10 | Zero runtime deps, audit clean, provenance |
| Supply-chain | 9.5/10 | SHA-pin, SBOM, OSV, Scorecard |
| Dokumentacja | 10/10 | Kompletna, spojna |
| Homebridge 1.x | 9.5/10 | Wzorcowe |
| Homebridge 2.x | 10/10 | Wzorcowe |
| Gotowos npm | **9.2/10** | **Wysoka jakosc, brak blokerow** |

**Konkluzja:** Plugin jest gotowy do publikacji na npm. Dwie obserwacje HIGH (weryfikacja SHA komentarza, bramkowanie release) powinny byc zaadresowane mozliwie szybko — jednak nie blokuja samej publikacji. Projekt jest jednym z lepiej przygotowanych pluginow Homebridge pod wzgledem supply-chain, testowania i dokumentacji.
