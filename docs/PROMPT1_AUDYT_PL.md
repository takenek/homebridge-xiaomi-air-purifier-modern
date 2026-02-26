# PROMPT 1 — Analiza problemów i raport audytu jakości
## Projekt: `xiaomi-mi-air-purifier-ng`
## Data: 2026-02-26

## Metodyka i wykonane kontrole
Przeanalizowano cały projekt: kod źródłowy (`src/**`), testy (`test/**`), konfigurację npm/TS/lint, workflow CI/Release/Dependabot, dokumentację i pliki OSS governance.

Wykonane komendy (zgodnie z wymaganiem `env -u npm_config_http_proxy -u npm_config_https_proxy`):

- `env -u npm_config_http_proxy -u npm_config_https_proxy npm ci`
- `env -u npm_config_http_proxy -u npm_config_https_proxy npm run lint`
- `env -u npm_config_http_proxy -u npm_config_https_proxy npm run typecheck`
- `env -u npm_config_http_proxy -u npm_config_https_proxy npm test`

Wynik testów: **62/62 PASS** oraz **100% coverage** (statements/branches/functions/lines) dla skonfigurowanego zestawu testów Vitest.

---

## Executive summary (najważniejsze plusy i ryzyka)
1. **Architektura runtime jest dojrzała i czytelna**: dobre rozdzielenie warstw Homebridge ↔ klient urządzenia ↔ transport MIIO, z sensownym SRP i testowalnością.
2. **Niezawodność działania stoi na wysokim poziomie**: kolejka operacji, retry/backoff z jitterem, reconnect lifecycle, czyszczenie timerów i testy scenariuszy awarii sieci.
3. **Projekt jest blisko „npm-ready” i „high-quality OSS”**: ma komplet kluczowych plików governance (LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, templates, Dependabot, CI, release workflow).
4. **Główne ryzyko jakościowe dotyczy pokrycia transportu MIIO**: `src/core/miio-transport.ts` jest wyłączony z coverage threshold 100%, co osłabia gwarancję regresji na najtrudniejszej warstwie.
5. **Główne ryzyko produktowe**: zadeklarowana kompatybilność z Homebridge 2.x istnieje, ale brakuje jawnego test matrix dla samej wersji Homebridge (obecnie matrix dotyczy Node.js).
6. **Supply-chain wygląda dobrze**: brak znanych vulnerability po `npm ci`; jedyne deprecated to `q@1.1.2` (transytywnie przez Homebridge 1.x), zgodnie z założeniem akceptowalne.

---

## 1) Analiza struktury repo i jakości API

### Mocne strony
- Spójna struktura: `src/accessories`, `src/core`, `test`, `docs`.
- Dobre API graniczne:
  - `XiaomiAirPurifierAccessoryPlugin` waliduje i normalizuje config wejściowy,
  - `DeviceClient` abstrahuje retry/polling/kolejkowanie,
  - `ModernMiioTransport` izoluje protokół i fallback MIOT/legacy.
- `package.json` zawiera wszystkie istotne metadane npm (`repository`, `bugs`, `homepage`, `files`, `engines`, `peerDependencies`, `keywords`).

### Obszary do poprawy
- W `scripts` są jednocześnie `prepare` i `prepack` budujące projekt (lekka redundancja, nie blocker).
- Wersjonowanie i release są poprawne, ale jeszcze nie „enterprise-grade” (manualne bumpowanie zamiast semantic-release/changesets).

---

## 2) Zgodność ze standardami Homebridge 1.x i 2.x

### Rejestracja i lifecycle
- Rejestracja accessory plugin jest poprawna (`registerAccessory`).
- Inicjalizacja, polling i shutdown są obsłużone poprawnie (timery `unref()`, cleanup na `shutdown`, domknięcie transportu).
- Dobre zachowanie reconnect/disconnect, z sygnałami stanu i logowaniem operacyjnym.

### Dobre praktyki Homebridge
- Walidacja configu (name/address/token/model) jest obecna.
- Aktualizacja charakterystyk jest cache’owana i odświeżana po state update, co ogranicza zbędne write’y do HomeKit.
- Mapowanie funkcji purifiera na HomeKit jest sensowne (Power/Active, AQI, Temperature, Humidity, Child Lock, LED, Mode, Filter Maintenance).

### Homebridge 1.x vs 2.x
- Deklaracje kompatybilności są formalnie poprawne (`^1.11.1 || ^2.0.0`).
- Rekomendacja: dodać test job z macierzą Homebridge (np. 1.x i 2.x), nie tylko Node.js.

**Ocena zgodności:**
- Homebridge 1.x: **9.0/10**
- Homebridge 2.x: **8.0/10**

---

## 3) Jakość kodu Node.js/TypeScript

### Asynchroniczność i błędy
- Plusy:
  - serializacja operacji (`operationQueue`),
  - bezpieczne tłumienie błędów poprzednich zadań kolejki,
  - retryable classification + backoff,
  - odporność na wyjątki listenerów (nie zrywają głównego przepływu).
- Ryzyko:
  - brak unsubscribe dla listenerów w `DeviceClient` (niewielkie, ale warto dodać dla testowalności/ergonomii).

### Typowanie i safety
- TS strict jest dobrze ustawiony (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, itp.).
- Walidacja tokenu/modelu/timeoutów jest sensowna i defensywna.

### Architektura i testowalność
- Bardzo dobry podział warstwowy i granice odpowiedzialności.
- Testy jednostkowe pokrywają core policy i branching logic.

### Zasoby / wydajność / logowanie
- Timery i socket lifecycle są zarządzane poprawnie.
- Polling jest konfigurowalny i rozsądny domyślnie.
- Logi nie ujawniają tokenu; zawierają adres IP urządzenia (akceptowalne operacyjnie, ale warto mieć opcję „privacy mode”).

---

## 4) Security & Supply Chain

### Co jest dobrze
- Brak logowania tajnych danych (token).
- `SECURITY.md` jest obecny z zasadami zgłaszania podatności.
- Lockfile obecny, Dependabot obejmuje npm i GitHub Actions.
- CI i release wykonują `npm audit --audit-level=high`.

### Ryzyka i rekomendacje
- MIIO to protokół LAN/UDP bez TLS end-to-end — to ograniczenie technologii, nie błąd implementacji.
- Warto dopisać w README sekcję hardeningu sieci IoT (VLAN/ACL/segmentacja).
- Warto rozważyć `npm publish --provenance` i ewentualnie SBOM (CycloneDX) w CI.

### Wymóg zależności deprecated/vulnerable
- Stan zgodny z wymaganiem: brak wykrytych vulnerabilites po `npm ci`; deprecated `q@1.1.2` występuje transytywnie przez Homebridge 1.x i jest wyjątkiem akceptowalnym.

---

## 5) Testy, CI/CD, automatyzacja

### Aktualny poziom
- Lint (`biome`), typecheck (`tsc`), test (`vitest --coverage`) oraz build działają poprawnie lokalnie.
- CI ma matrix Node 20/22/24 i osobny audit job.
- Release jest realizowany workflow tagowym `v*.*.*` + publish na npm.

### Kluczowy niedobór
- `vitest.config.ts` wyklucza `src/core/miio-transport.ts` z coverage. Formalnie 100% jest spełniane, ale nie obejmuje najwrażliwszej warstwy sieciowej.

### Rekomendacje
- Dodać testy transportu (mock socketa/packet parsing) i usunąć exclusion z coverage.
- Rozważyć fully automated release (semantic-release/changesets + changelog + tagging), by ograniczyć błędy manualne.

---

## 6) Checklista „czy czegoś nie brakuje” (npm/Homebridge)

### Obecne (✅)
- ✅ LICENSE
- ✅ README z konfiguracją i troubleshootingiem
- ✅ CHANGELOG
- ✅ CONTRIBUTING
- ✅ CODE_OF_CONDUCT
- ✅ SECURITY.md
- ✅ issue templates + PR template
- ✅ tsconfig
- ✅ linter/formatter config (Biome)
- ✅ package-lock.json
- ✅ `files` whitelist i spójny output `dist/`
- ✅ `keywords`, `homepage`, `repository`, `bugs`
- ✅ deklaracja kompatybilności Node/Homebridge + peer dependency
- ✅ Dependabot (npm + Actions)

### Braki / do poprawy (⚠️)
- ⚠️ Brak testów pokrywających `src/core/miio-transport.ts` przy polityce 100% coverage.
- ⚠️ Brak automatycznego semantic versioningu/release notes (obecnie proces częściowo manualny).
- ⚠️ Brak jawnej polityki deprecations/support window w README/CONTRIBUTING.

---

## 7) Krytyczne problemy (blokery publikacji npm)

**Na obecnym stanie: brak twardych blockerów publikacji.**

Uzasadnienie:
- Build/lint/typecheck/test przechodzą,
- coverage dla uruchamianego zestawu testów wynosi 100%,
- npm audit nie zgłasza vulnerability,
- projekt ma komplet podstawowych elementów OSS governance.

> Uwaga: wyłączenie `miio-transport.ts` z coverage traktuję jako **high-risk improvement**, ale nie jako absolutny blocker publikacji.

---

## 8) Lista usprawnień z priorytetami

### HIGH
1. **Pokryć testami `src/core/miio-transport.ts` i usunąć exclusion z coverage.**
2. **Dodać matrix zgodności Homebridge 1.x/2.x w CI** (co najmniej smoke test).

### MEDIUM
1. Przejść na semantic-release/changesets i automatyczny changelog.
2. Dodać privacy toggle ograniczający logowanie adresu IP urządzenia.
3. Dodać sekcję „Network Hardening” w README.

### LOW
1. Dopisać politykę deprecations/support window.
2. Rozważyć SBOM/provenance dla łańcucha dostaw.

---

## 9) Sugestie konkretnych zmian w plikach

### 9.1 `vitest.config.ts`
Docelowo usunąć exclusion transportu:

```ts
coverage: {
  include: ["src/**/*.ts"],
  exclude: [],
  thresholds: {
    lines: 100,
    branches: 100,
    functions: 100,
    statements: 100,
  },
}
```

### 9.2 `.github/workflows/ci.yml`
Dodać job (lub matrix axis) z Homebridge 1.x i 2.x, np. przez pinowanie wersji `homebridge` w kroku testowym.

### 9.3 `README.md`
Dodać sekcję security hardening (VLAN/ACL/IoT SSID, brak ekspozycji UDP 54321 poza LAN).

### 9.4 release automation
Rozważyć `semantic-release` / `changesets`, aby zautomatyzować wersjonowanie i changelog.

---

## 10) Finalna ocena gotowości do npm

**Status: READY (z zaleceniami jakościowymi).**

Projekt jest technicznie gotowy do publikacji npm i utrzymania jako wysokiej jakości OSS, z rekomendacją priorytetowego domknięcia testów warstwy transportowej i dopracowania automatyzacji release.
