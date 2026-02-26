# Raport audytu jakości i gotowości do publikacji npm
## Projekt: `xiaomi-mi-air-purifier-ng`
## Data: 2026-02-26

## Zakres i metodyka
Przegląd obejmuje cały repozytoryjny zakres wskazany w zadaniu:
- kod źródłowy (`src/**`), testy (`test/**`), dokumentację i checklisty (`README.md`, `CHANGELOG.md`, `RELEASE_CHECKLIST.md`, `docs/**`),
- metadane i publikację (`package.json`, `package-lock.json`, `config.schema.json`),
- automatyzację (`.github/workflows/*.yml`, `.github/dependabot.yml`, issue/PR templates),
- zgodność architektury z modelem pluginu Homebridge (accessory plugin) i mapowanie HomeKit.

Wykonane kontrole lokalne:
- `./node_modules/.bin/biome check .` → **NIEZALICZONE** (formatting drift),
- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` → **ZALICZONE**,
- `./node_modules/.bin/vitest run --coverage` → **NIEZALICZONE** (6 testów failed),
- `npm ci` / `npm run ...` → **niewykonalne** w tym środowisku (npm 11 kończy kodem 1 bez diagnostyki poza logiem technicznym).

---

## Executive summary (najważniejsze wnioski)
1. **Solidna baza architektury runtime**: dobry podział na warstwę Homebridge (`AirPurifierAccessory`), klienta domenowego (`DeviceClient`) i transport MIIO (`ModernMiioTransport`) z retry/backoff i kolejką operacji.
2. **Dobry fundament OSS governance**: obecne `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, templates issue/PR, CI i Dependabot.
3. **Aktualny stan testów blokuje profesjonalne wydanie**: test suite nie jest zielony (6 failed), a część testów ujawnia regresję kompatybilności kontraktu akcesorium.
4. **Rozjazd schema vs runtime**: `config.schema.json` nadal eksponuje opcje sensorów (`enableAirQuality`, `enableTemperature`, `enableHumidity`), których runtime nie konsumuje.
5. **Jakość operacyjna jest wysoka, ale release automation średnia**: wydania tag-driven są obecne, jednak brak pełnego semantic-release/conventional-commits i automatycznego changelog governance.
6. **Kompatybilność Homebridge 1.x/2.x jest kierunkowo dobra**, ale wymaga doprecyzowania wsparcia Homebridge 2.x (stabilność API, test matrix i polityka wsparcia).

---

## 1) Analiza struktury, konfiguracji i jakości API

### Co działa dobrze
- Projekt ma przejrzystą strukturę (`src/accessories`, `src/core`, `test`) i wyraźny podział odpowiedzialności.
- `package.json` zawiera komplet metadanych npm (`homepage`, `repository`, `bugs`, `files`, `keywords`, `engines`, `peerDependencies`).
- Publikacja npm oparta o `dist/` i `prepack` jest spójna z TS build.

### Problemy i ryzyka
- **Rozjazd konfiguracji użytkownika**: schema UI oferuje klucze niezaimplementowane w runtime (patrz sekcja krytyczna).
- `prepare` i `prepack` obu wyzwalają build — nie jest to błąd, ale bywa redundantne i może wydłużać pipeline lokalny.
- Część dokumentacji sugeruje zachowania, które nie są już testowo potwierdzone przy obecnym stanie testów.

---

## 2) Zgodność ze standardami Homebridge 1.x i 2.x

### Rejestracja, init/shutdown, restarty
- Rejestracja accessory plugin jest poprawna (`registerAccessory`).
- Lifecycle runtime jest poprawnie obsłużony: inicjalizacja klienta, polling, cleanup timerów i shutdown.
- Dobre zachowanie przy reconnect: zdarzenia `connected/disconnected/reconnected`, retry/backoff + jitter.

### Praktyki Homebridge
- Logowanie poziomowane (`debug/info/warn/error`) i brak jawnego logowania tokenu.
- Aktualizacja charakterystyk po zmianach stanu działa, ale obecna implementacja ma punkt ryzyka (patrz testy: `Reflect.get called on non-object`).
- Polling i odświeżanie są sensownie rozdzielone (operation/sensor/keepalive).

### Kompatybilność 1.x / 2.x
- Deklaracje `engines`/`peerDependencies` formalnie obejmują 1.11.1 i 2.x.
- Rekomendacja: utrzymać matrix CI dla Homebridge 1.x + 2.x (gdy 2.x stabilne), nie tylko Node matrix.

### Mapowanie funkcji oczyszczacza na HomeKit
- Mapowanie jest rozsądne: `AirPurifier`/fallback `Switch`, `AirQualitySensor`, `FilterMaintenance`, przełączniki trybów i opcjonalny alert filtra.
- Ryzyko UX: dual-switch mode policy (AUTO/NIGHT) może być myląca bez bardzo precyzyjnego opisu edge-case’ów power-off.

**Ocena punktowa:**
- Homebridge 1.x: **8.5/10**
- Homebridge 2.x: **7.5/10**

---

## 3) Najwyższe standardy jakości kodu (Node.js/TS)

### Asynchroniczność i obsługa błędów
- Plusy:
  - serializacja operacji przez kolejkę,
  - retry z backoff+jitter,
  - bezpieczny polling (`safePoll`) i obsługa błędów listenerów.
- Ryzyka:
  - brak unsubscribe API dla listenerów (nie krytyczne dla obecnego lifetime, ale ogranicza testowalność/reuse),
  - testy wykrywają błąd defensywności w `updateCharacteristicIfNeeded` (`Reflect.get` na non-object).

### Typowanie i walidacja
- Plusy:
  - dobre typy domenowe i walidacja tokenu/modelu/timeoutów.
- Ryzyka:
  - schema/runtime drift osłabia kontrakt API pluginu,
  - fallbacki enumów HomeKit wymagają utrzymania testów regresyjnych (obecnie czerwone).

### Zarządzanie zasobami i wydajność
- Timery są czyszczone na shutdown, używany `unref()`, co jest zgodne z dobrymi praktykami.
- Interwały pollingowe są rozsądne i konfigurowalne.

### Logowanie
- Dobry poziom diagnostyki połączeń.
- Rekomendacja: dodać jawny dokument „redaction policy” (co nigdy nie trafia do logów).

---

## 4) Security & Supply Chain

### Dane wrażliwe
- Token nie jest logowany jawnie.
- Repo zawiera `SECURITY.md` i standardowe pliki governance.

### Komunikacja z urządzeniem
- Model LAN MIIO (UDP) ma naturalne ograniczenia bezpieczeństwa (sieć lokalna, token, brak TLS end-to-end na LAN w tym protokole).
- Rekomendacja: w README dodać sekcję hardening LAN (VLAN/IoT SSID, ACL, ograniczenia ruchu).

### Zależności i podatności
- Dependabot obejmuje npm + GitHub Actions.
- CI wykonuje `npm audit --audit-level=high` (to plus).
- Rekomendacja: dodać cykliczny workflow security (np. nightly) oraz raportowanie SARIF (np. CodeQL / npm-audit-json parser).

---

## 5) Testy, CI/CD i automatyzacja

### Aktualna dojrzałość
- Testy istnieją i obejmują scenariusze reliability/network/mappers/device-client.
- CI matrix Node 20/22/24 + audit job jest poprawny.

### Krytyczny problem
- **Test suite nie jest zielony** (`test/accessory-platform-index.test.ts`: 6 failed).
- To jest blocker jakości przed publikacją jako „high-quality OSS”.

### Release workflow
- Publikacja tag-driven działa (`release.yml`), ale:
  - brak semantic-release/changesets,
  - brak automatycznej walidacji konwencji commitów,
  - changelog i wersjonowanie bardziej manualne niż „professional-grade”.

---

## 6) Checklist „czy czegoś nie brakuje” (npm/Homebridge)

### Obecne (✅)
- ✅ `LICENSE`
- ✅ `README` (instalacja, konfiguracja, troubleshooting)
- ✅ `CHANGELOG`
- ✅ `CONTRIBUTING`
- ✅ `CODE_OF_CONDUCT`
- ✅ `SECURITY.md`
- ✅ issue templates + PR template
- ✅ `tsconfig`, formatter/linter config (`biome.json`)
- ✅ Dependabot (npm + actions)
- ✅ `keywords`, `homepage`, `repository`, `bugs`
- ✅ `files` whitelist do publikacji npm
- ✅ `engines` i `peerDependencies` z Homebridge

### Braki / do dopracowania (⚠️)
- ⚠️ Zielony status testów przed release (obecnie FAIL).
- ⚠️ Spójność `config.schema.json` ↔ runtime.
- ⚠️ Profesjonalizacja release automation (semantic-release/changesets + policy commitów).
- ⚠️ Formalna polityka deprecations w README/CONTRIBUTING.
- ⚠️ Dodatkowe hardening guidance security dla sieci LAN.

---

## 7) Krytyczne problemy (blokery publikacji)

1. **Niezielone testy jednostkowe/integracyjne**
   - Bez stabilnego test suite publikacja grozi regresją funkcjonalną.
   - Priorytet: natychmiastowy.

2. **Schema-runtime mismatch**
   - Użytkownik Homebridge UI widzi opcje, które nie działają.
   - Priorytet: natychmiastowy.

3. **Regresja defensywności przy aktualizacji charakterystyk**
   - Błąd `Reflect.get called on non-object` wskazuje na brak guardów typu runtime.
   - Priorytet: natychmiastowy.

---

## 8) Usprawnienia (priorytety high/medium/low)

### HIGH
- Naprawić wszystkie failing testy i wymusić „green-only release”.
- Dodać guard w `updateCharacteristicIfNeeded` dla nieobiektowych characteristic references.
- Ujednolicić schema/runtime (albo implementacja toggle’ów sensorów, albo usunięcie z UI schema).

### MEDIUM
- Dodać release automation (semantic-release lub changesets).
- Rozszerzyć CI o Homebridge 2.x compatibility smoke test.
- Dodać testy kontraktowe dla mapowania charakterystyk HomeKit.

### LOW
- Dodać politykę deprecations i support window.
- Dodać `funding` i sekcję maintainers/ownership.

---

## 9) Konkretne propozycje zmian w plikach

### 9.1 `package.json` (release automation)
Przykładowy kierunek:
```json
{
  "scripts": {
    "release": "semantic-release",
    "check": "npm run lint && npm run typecheck && npm test"
  },
  "devDependencies": {
    "semantic-release": "^24.0.0",
    "@semantic-release/changelog": "^6.0.0",
    "@semantic-release/git": "^10.0.0",
    "@semantic-release/npm": "^12.0.0",
    "@semantic-release/github": "^11.0.0"
  }
}
```

### 9.2 `config.schema.json` (spójność z runtime)
Opcja A (krótkoterminowa): usunąć nieobsługiwane klucze z layoutu/`properties`.

Opcja B (docelowa): zaimplementować przełączniki sensorów w `src/accessories/air-purifier.ts` i pokryć testami kontraktowymi.

### 9.3 `src/accessories/air-purifier.ts` (defensywność runtime)
Dodać guard typu przed `Reflect.get`:
```ts
if (typeof characteristic !== "function" && (typeof characteristic !== "object" || characteristic === null)) {
  return;
}
```

### 9.4 `.github/workflows/ci.yml` (jakość bramki)
Dodać warunek publikacji tylko przy zielonych testach + opcjonalny job smoke z Homebridge 2.x (gdy stabilne).

---

## 10) Finalna ocena gotowości do npm

**Status:** `NOT READY` (warunkowo blisko gotowości).

Aby przejść na `READY`:
1. Naprawić 6 failing testów.
2. Zamknąć schema/runtime drift.
3. Zabezpieczyć defensywność aktualizacji charakterystyk.
4. (Rekomendowane) podnieść release automation do poziomu semantic-release/changesets.

Po wdrożeniu powyższego projekt ma bardzo dobre fundamenty techniczne i operacyjne do utrzymania jako wysokiej jakości OSS.
