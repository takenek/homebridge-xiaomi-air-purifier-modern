# Raport audytu jakości i gotowości do publikacji npm
## Projekt: `xiaomi-mi-air-purifier-ng`
## Data: 2026-02-26

## Zakres analizy
Przeanalizowano cały projekt: kod (`src/**`), testy (`test/**`), konfiguracje (`package.json`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `config.schema.json`), automatyzację (`.github/workflows/*`, `dependabot`), dokumentację i governance (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, checklisty oraz templates).

## Wykonane kontrole lokalne
- `./node_modules/.bin/biome check .` ✅
- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` ✅
- `./node_modules/.bin/vitest run --coverage` ✅ (60 testów, coverage: 99.18% statements, 95.92% branches)
- `npm ci` ⚠️ (w tym środowisku npm 11 kończy się błędem bez diagnostyki projektowej, patrz log npm)

---

## Executive summary
1. **Projekt jest technicznie dojrzały**: dobra architektura warstwowa (`platform`/`accessory`/`core`), wysoki poziom typowania TypeScript i bardzo dobre pokrycie testami.
2. **Zgodność Homebridge 1.x/2.x jest dobrze zaadresowana**: poprawna rejestracja accessory plugin, poprawna obsługa lifecycle, fallback dla starszych API HAP.
3. **Stabilność runtime jest mocną stroną**: kolejka operacji, retry/backoff z jitter, obsługa reconnect i cleanup timerów przy shutdown.
4. **Supply-chain jest na dobrym poziomie**: Dependabot (npm + actions), audyt w CI, ograniczone uprawnienia workflow.
5. **Największe braki przed „top-tier OSS” są procesowe, nie kodowe**: brak automatycznego release governance (semantic-release/changesets), brak stricte wymuszonego build kroku w CI, drobne niespójności dokumentacyjne.

---

## 1) Analiza struktury i jakości API

### Mocne strony
- Czytelna struktura i separacja odpowiedzialności:
  - `src/index.ts` — rejestracja pluginu,
  - `src/platform.ts` — walidacja configu i budowa zależności,
  - `src/accessories/air-purifier.ts` — mapowanie HomeKit,
  - `src/core/*` — logika urządzenia, transport, retry, mapowania.
- Konfiguracja wejścia jest defensywna (token hex, model allowlist, timeouty i wartości progowe z normalizacją).
- API użytkowe pluginu jest relatywnie stabilne i jasno opisane w README + `config.schema.json`.

### Ryzyka
- `prepare` + `prepack` uruchamiają build przy różnych etapach; to poprawne, ale potencjalnie wydłuża lokalny DX.
- CI nie wykonuje jawnego `npm run build` (jest lint/typecheck/test), więc błąd emitowania `dist` mógłby zostać wykryty dopiero przy publikacji.

---

## 2) Zgodność ze standardami Homebridge 1.x i 2.x

### Rejestracja i lifecycle
- Rejestracja accessory plugin przez `api.registerAccessory(...)` jest zgodna z wzorcem Homebridge accessory plugin.
- `AirPurifierAccessory` poprawnie inicjalizuje klienta, podłącza subskrypcję stanu i nasłuchuje `api.on("shutdown")` z bezpiecznym zamknięciem transportu.
- Obsługa reconnect i resetów połączenia jest zaimplementowana i logowana zdarzeniami semantycznymi (`connected/disconnected/reconnected`).

### Praktyki Homebridge
- Dobre logowanie poziomowane (`debug/info/warn/error`) i brak celowego logowania tokenu.
- Dobre mapowanie charakterystyk z cache i `onGet`, co ogranicza zbędne aktualizacje HomeKit.
- Fallback na `Service.Switch` gdy natywny `Service.AirPurifier` nie występuje, co poprawia zgodność między wersjami/stosami HAP.

### Kompatybilność i deklaracje
- `engines` i `peerDependencies` deklarują Homebridge `^1.11.1 || ^2.0.0` oraz Node 20/22/24 — to spójne z deklarowanym wsparciem.
- Brakuje jednak osobnego smoke-testu kompatybilności z Homebridge 2.x w CI (obecnie matrix dotyczy tylko Node).

### Mapowanie funkcji oczyszczacza na HomeKit
- Mapowanie AQI, temperatury, wilgotności, zasilania, trybów, child-lock i filtra jest kompletne oraz sensownie opisane.
- Polityka trybów AUTO/NIGHT przy wyłączonym zasilaniu (ignorowanie write) jest przewidywalna i logiczna.

**Ocena zgodności:**
- Homebridge 1.x: **9/10**
- Homebridge 2.x: **8/10** (minus za brak dedykowanego smoke jobu i brak explicit test matrix po stronie HB)

---

## 3) Jakość kodu Node.js/TS

### Async/error/retry
- Bardzo dobre wzorce:
  - serializacja operacji przez kolejkę,
  - retry/backoff z limitem, jitter i klasyfikacją retryable errors,
  - bezpieczne pollowanie i izolowanie błędów listenerów.

### Typowanie i walidacja
- `strict` TS + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` zwiększają niezawodność.
- Walidacja configu runtime jest spójna z `config.schema.json` (w szczególności toggles sensorów i child lock).

### Architektura i testowalność
- SRP zachowane; moduły core są łatwo testowalne (co widać po liczbie testów gałęziowych).
- Dobry kompromis między abstrakcją i prostotą (transport jako interfejs `MiioTransport`).

### Zasoby/wydajność
- Timery są czyszczone przy shutdown i `unref()` ogranicza ryzyko blokowania procesu.
- Polling jest konfigurowalny i rozdzielony na kanały (operacyjny/sensory/keepalive), co daje dobrą kontrolę nad obciążeniem.

### Logging
- Logi są użyteczne operacyjnie.
- Drobne usprawnienie: dodać w README sekcję explicit redaction policy (co jest zawsze maskowane i czego nie logować w issue).

---

## 4) Security & Supply Chain

### Co jest dobrze
- `SECURITY.md` obecny i sensowny proces zgłaszania podatności.
- Dependabot obejmuje zależności npm oraz GitHub Actions.
- CI i release workflow uruchamiają `npm audit --audit-level=high`.
- Publikacja korzysta z whitelisty `files`, co ogranicza powierzchnię artefaktu npm.

### Ryzyka i rekomendacje
- Protokół MIIO (UDP/LAN) z natury nie jest E2E TLS; to ograniczenie domenowe, nie błąd implementacji.
- Warto dodać twarde zalecenia hardeningu LAN (VLAN/IoT SSID/ACL) w README.
- W `release.yml` warto jawnie użyć `npm publish --provenance` (CHANGELOG już to sugeruje, workflow jeszcze nie).

---

## 5) Testy, CI/CD i automatyzacja

### Obecny stan
- Testy są rozbudowane (60 testów), pokrywają kluczowe ścieżki i scenariusze reliability.
- Lint/typecheck/test są uruchamiane w CI na Node 20/22/24.
- Coverage thresholds (95/90/95/95) są skonfigurowane i przekraczane.

### Luki do zamknięcia
- Brak jawnego kroku `npm run build` w CI.
- Brak automatyki release typu semantic-release/changesets + auto-tagging/changelog (obecnie release jest tag-driven/manual).
- Brak quality gate dla Conventional Commits (mimo deklaracji w CONTRIBUTING).

---

## 6) Checklist „czy czegoś nie brakuje” (npm/Homebridge)

### Jest (✅)
- ✅ LICENSE
- ✅ README (instalacja, konfiguracja, troubleshooting, mapowanie)
- ✅ CHANGELOG
- ✅ CONTRIBUTING
- ✅ CODE_OF_CONDUCT
- ✅ SECURITY.md
- ✅ issue templates i PR template
- ✅ tsconfig + lint/format config
- ✅ lockfile (`package-lock.json`)
- ✅ Dependabot (npm + actions)
- ✅ `keywords`, `homepage`, `repository`, `bugs`
- ✅ `files` whitelist i build do `dist/`
- ✅ deklaracje kompatybilności Node/Homebridge (`engines`, `peerDependencies`)

### Brakuje / do poprawy (⚠️)
- ⚠️ `CONTRIBUTING` deklaruje Conventional Commits, ale brak enforcement w CI.
- ⚠️ Brak automatyzacji release governance (semantic-release/changesets).
- ⚠️ Brak explicit build kroku w CI.
- ⚠️ Brak formalnej polityki deprecations/support window w dokumentacji.
- ⚠️ Drobna niespójność: CHANGELOG wspomina provenance publish, workflow publikuje bez jawnego `--provenance`.

---

## 7) Lista krytycznych problemów (blokery publikacji na npm)

**Ocena: brak krytycznych blockerów kodowych na ten moment.**

Publikację mogą blokować jedynie kwestie procesowe/organizacyjne jeśli celem jest „enterprise-grade OSS”:
1. Brak automatycznego release governance.
2. Brak wymuszenia build kroku w CI.

To nie są błędy funkcjonalne pluginu, ale obniżają poziom profesjonalizacji pipeline’u.

---

## 8) Lista usprawnień (priorytety)

### HIGH
1. Dodać `npm run build` do CI (po typecheck/test).
2. Ujednolicić workflow publikacji z deklaracją changelog: `npm publish --provenance`.

### MEDIUM
3. Wdrożyć semantic-release albo changesets + automatyczny changelog/tagi.
4. Dodać walidację Conventional Commits (np. commitlint + action).
5. Dodać smoke job z Homebridge 2.x.

### LOW
6. Dodać sekcję deprecations policy/support window.
7. Rozszerzyć SECURITY/README o checklistę hardeningu LAN.

---

## 9) Konkretne propozycje zmian w plikach

### 9.1 `.github/workflows/ci.yml`
Dodaj build gate:
```yaml
      - run: npm run build
```

### 9.2 `.github/workflows/release.yml`
Zmień publikację na provenance:
```yaml
      - run: npm publish --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 9.3 `package.json` (wariant semantic-release)
```json
{
  "scripts": {
    "release": "semantic-release"
  },
  "devDependencies": {
    "semantic-release": "^24.0.0",
    "@semantic-release/changelog": "^6.0.0",
    "@semantic-release/git": "^10.0.0",
    "@semantic-release/github": "^11.0.0",
    "@semantic-release/npm": "^12.0.0"
  }
}
```

### 9.4 `README.md` (security hardening)
Dopisz krótką sekcję:
- trzymaj urządzenia IoT w osobnym VLAN,
- ogranicz ruch do hosta Homebridge,
- nie publikuj tokenów ani pełnych logów z danymi sieciowymi.

---

## 10) Finalna ocena „gotowe do npm”

**Status:** `READY (technicznie)` / `NEEDS PROCESS POLISH (operacyjnie)`.

Projekt jest gotowy funkcjonalnie i jakościowo do publikacji npm. Aby osiągnąć poziom „high-quality, long-term OSS”, rekomendowane jest domknięcie automatyzacji release governance, dołożenie build gate w CI i doprecyzowanie security/deprecation policy.
