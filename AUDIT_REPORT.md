# Raport code review i audytu jakości

Projekt: **xiaomi-mi-air-purifier-ng** / npm package `homebridge-xiaomi-air-purifier-modern`.
Data audytu: 2026-02-27.

## 1) Executive summary

- Projekt jest na wysokim poziomie dojrzałości OSS: TypeScript strict, mocne testy (84 testy, 100% coverage), CI dla wielu wersji Node/Homebridge, release przez semantic-release oraz osobne workflow supply-chain.  
- Implementacja pluginu jest zasadniczo zgodna z Homebridge 1.x/2.x: poprawna rejestracja accessory, fallback Homebridge 1.x (Switch), natywne AirPurifier dla 2.x, cleanup timerów i transportu przy shutdown.  
- Największe ryzyko techniczne: brak twardej walidacji IP/modelu w runtime poza prostym `assertString` (dla adresu IP), co przy konfiguracji poza UI Homebridge może prowadzić do trudniejszych diagnostycznie błędów.  
- Największa luka jakościowa przed „production polish”: README odwołuje się do nieistniejącego pliku `docs/reliability-testing.md` (broken docs path).  
- W obszarze security/supply chain projekt jest solidny: lockfile, npm audit w CI i release, SBOM + OSV scanner, minimalne uprawnienia workflow.  
- Brak krytycznych blockerów bezpieczeństwa lub jakości, które uniemożliwiałyby publikację na npm, ale rekomendowane są usprawnienia hardeningowe i dokumentacyjne.

## 2) Zakres analizy

Przeanalizowane obszary:
- Struktura repo i modułów `src/core`, `src/accessories`, `src/platform`.
- Konfiguracja npm (`package.json`), TypeScript (`tsconfig*.json`), lint/format (`biome.json`, `.editorconfig`).
- Testy (`vitest.config.ts`, `test/*.test.ts`).
- CI/CD (`.github/workflows/*.yml`, `.releaserc.json`, Dependabot).
- Dokumentacja i governance (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, checklisty release).

## 3) Zgodność ze standardami Homebridge 1.x i 2.x

### Ocena ogólna
- **Homebridge 1.x: 9.0/10**
- **Homebridge 2.x: 9.5/10**

### Co jest dobrze
- Rejestracja accessory przez `api.registerAccessory(...)` jest poprawna dla modelu accessory plugin.  
- Fallback między HB 2.x (natywny `AirPurifier`) i HB 1.x (`Switch`) jest zaimplementowany defensywnie przez `Reflect.get` i `usesNativePurifierService`.  
- Obsługa lifecycle: `api.on("shutdown", ...)` wywołuje `client.shutdown()`, a `DeviceClient.shutdown()` czyści timery i zamyka transport.  
- Obsługa reconnect/retry jest obecna (exponential backoff + jitter, retryable errors, eventy connected/disconnected/reconnected).  
- Aktualizacja charakterystyk i ograniczenie redundantnych update’ów przez cache (`updateCharacteristicIfNeeded`) ogranicza noise i obciążenie.

### Co poprawić
1. **Walidacja runtime adresu IP**: `address` jest walidowany jako non-empty string, ale bez twardego parsera IPv4/hostname; schema UI pomaga, lecz nie chroni konfiguracji poza UI.  
2. **Tryb pracy/charakterystyki**: mapowanie `TargetAirPurifierState` tylko AUTO/MANUAL jest logiczne, ale warto jawnie opisać w README mapowanie `sleep` -> `MANUAL`, by uniknąć nieporozumień użytkowników.  
3. **Degradacja service set**: dodać testy E2E-ish dla zachowania po restarcie Homebridge z niedostępnym urządzeniem i późniejszym powrotem (częściowo już pokryte testami jednostkowymi).

## 4) Jakość kodu Node.js/TypeScript

### Mocne strony
- `strict` TS + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, brak `any` (egzekwowane przez Biome).  
- Asynchroniczność jest kontrolowana przez kolejkę operacji (`operationQueue`) i sekwencyjne set+sync (`enqueueSetAndSync`), co redukuje race conditions.  
- Retry/backoff i retryable error policy są wydzielone do osobnego modułu (`core/retry.ts`) – dobra separacja odpowiedzialności.  
- `DeviceClient` zawiera defensywną obsługę błędów listenerów oraz cleanup timerów.

### Ryzyka / dług techniczny
- `AirPurifierAccessory` jest relatywnie „gruby” (wiele odpowiedzialności: tworzenie usług, bind handlerów, mapowanie stanu, logika filtra). Warto docelowo wydzielić część mapowań/char update do helperów.
- `setBuzzerVolume` istnieje w `DeviceClient`, ale nie jest eksponowane w accessory – może być świadome, ale warto udokumentować jako internal API albo usunąć, jeśli zbędne.
- Dodatkowy poll keepalive + operation + sensor może zwiększać load na słabszych sieciach; obecnie jest konfigurowalne, co jest plusem.

## 5) Security & Supply Chain

### Ocena
- **Wrażliwe dane**: token nie jest logowany; logowane są nazwa i IP (opcjonalnie maskowane). To sensowny kompromis operacyjny.  
- **Transport**: MIIO UDP/AES-CBC (protokół urządzenia) bez TLS – ograniczenie technologiczne, poprawnie odnotowane i opisane w README (LAN hardening).  
- **Supply chain**: lockfile obecny, `npm audit --audit-level=high` uruchamiany w CI oraz release workflow, dodatkowo SBOM i OSV scanner.

### Rekomendacje bezpieczeństwa
- Dodać opcjonalne ostrzeżenie przy `maskDeviceAddressInLogs=false`, gdy log level debug/info jest wysoki i środowisko może eksportować logi poza LAN.
- Rozważyć walidację/odrzucanie adresów spoza RFC1918 (opcjonalny feature flag), bo plugin i tak zakłada LAN device.
- Rozważyć podpisywanie release artifacts i publikację informacji o verified provenance także w README/SECURITY.

## 6) Testy, CI/CD i automatyzacja

### Co jest dobrze
- Testy są kompletne i rygorystyczne (100% coverage thresholds).  
- CI matrix obejmuje Node 20/22/24 i Homebridge stable + beta (smoke/full lanes).  
- Release workflow profesjonalny: semantic-release, changelog, publish npm z provenance, audyt przed release.
- Dependabot obejmuje npm + GitHub Actions.

### Co poprawić
- W CI warto dodać `npm pack --dry-run` i artefakt listy plików paczki dla kontroli publikacji.  
- Można dodać job „install-from-tarball smoke test” (np. `npm pack`, instalacja globalna z tarballa, sanity check require plugin entry).

## 7) „Czy czegoś nie brakuje” – checklista npm/Homebridge

- [x] LICENSE  
- [x] README z konfiguracją, mapowaniami i troubleshootingiem  
- [x] CHANGELOG  
- [x] CONTRIBUTING  
- [x] CODE_OF_CONDUCT  
- [x] SECURITY.md  
- [x] Issue templates / PR template  
- [x] tsconfig + lint/format config  
- [x] `files` whitelist do npm publish  
- [x] `keywords`, `homepage`, `repository`, `bugs` w package.json  
- [x] peerDependencies dla Homebridge  
- [x] Deklaracja engines Node/Homebridge  
- [x] Lockfile (`package-lock.json`)  
- [ ] **Spójność dokumentacji**: README wskazuje `docs/reliability-testing.md`, którego brak.  
- [ ] **CONTRIBUTING drift**: sekcja „Update CHANGELOG for user-visible changes” koliduje z semantic-release auto-flow (warto doprecyzować politykę).

## 8) Krytyczne problemy (blokery publikacji npm)

**Brak krytycznych blockerów publikacji** przy obecnym stanie technicznym i bezpieczeństwa.

## 9) Ważne usprawnienia (priorytety)

### High
1. Naprawić broken link do `docs/reliability-testing.md` (dodać plik lub usunąć odwołanie).
2. Dodać runtime walidację `address` (IPv4) i czytelny komunikat błędu.
3. Dodać `npm pack --dry-run` do CI/release checklisty i ewentualnie CI joba.

### Medium
1. Doprecyzować CONTRIBUTING vs semantic-release (kto i kiedy aktualizuje CHANGELOG).
2. Rozważyć mniejszy refactor `AirPurifierAccessory` na mniejsze komponenty (testowalność i czytelność).
3. Dodać testy scenariusza cold-start offline -> online na poziomie wyższym niż unit.

### Low
1. Rozważyć oznaczenie `homebridge` w `devDependencies` jako dokładnie spójne z matrix baseline.
2. Dodać `funding`/`maintainers` metadata (opcjonalne dla OSS UX).

## 10) Sugestie zmian w plikach (propozycje)

### A) `src/platform.ts` – walidacja IPv4

Propozycja (fragment):

```ts
import { isIP } from "node:net";

const assertIPv4 = (value: string, field: string): string => {
  if (isIP(value) !== 4) {
    throw new Error(`Invalid config field: ${field} must be a valid IPv4 address.`);
  }
  return value;
};

// ...
const address = assertIPv4(assertString(typedConfig.address, "address"), "address");
```

### B) `.github/workflows/ci.yml` – kontrola publikowalnej paczki

```yml
      - run: env -u npm_config_http_proxy -u npm_config_https_proxy npm run build
      - run: env -u npm_config_http_proxy -u npm_config_https_proxy npm pack --dry-run
```

### C) `CONTRIBUTING.md` – doprecyzowanie changelog policy

```md
## Changelog policy
- `CHANGELOG.md` jest aktualizowany automatycznie przez semantic-release na `main`.
- W PR-ach aktualizuj changelog ręcznie tylko dla wyjątkowych/manualnych hotfix flow.
```

### D) `README.md`
- Albo dodać `docs/reliability-testing.md`, albo usunąć link i zastąpić krótką sekcją „Reliability scenarios” inline.

## 11) Podsumowanie gotowości do npm

**Status: GOTOWE DO PUBLIKACJI (z zalecanymi poprawkami jakościowymi).**

Projekt spełnia wysoki standard OSS i Homebridge plugin engineering. Rekomenduję szybkie domknięcie 3 punktów High priority przed kolejną większą promocją/publiczną komunikacją pluginu.
