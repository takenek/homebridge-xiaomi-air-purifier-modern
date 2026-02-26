# Audyt jakości i bezpieczeństwa: homebridge-xiaomi-air-purifier-modern

Data: 2026-02-26
Zakres: pełny przegląd kodu, konfiguracji npm/CI, zgodności Homebridge, testów i supply-chain.

## 1) Executive summary

- Projekt jest technicznie dojrzały: TypeScript strict, nowoczesny transport MIIO (bez zewnętrznych bibliotek protokołu), sensowne mechanizmy retry/backoff i bardzo wysoka testowalność.
- CI/CD i automatyzacja są na dobrym poziomie (macierz Node/Homebridge, audit, release przez semantic-release, SBOM, Dependabot).
- Największe ryzyko publikacyjne: deklarowana kompatybilność z Homebridge 2.x jest testowana głównie w trybie smoke (beta), bez pełnej macierzy regresji funkcjonalnej.
- Bezpieczeństwo runtime jest dobre (maskowanie IP opcjonalne, brak logowania tokena, ograniczony zakres informacji w logach), ale warto doprecyzować Security Policy o proces triage CVE/dependency advisories.
- Dokumentacja jest mocna (README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG), ale przyda się jawna tabela kompatybilności feature-by-feature dla HB 1.x vs 2.x.
- Kryterium jakości testów zostało spełnione: `vitest --coverage` osiąga 100% statements/branches/functions/lines.

## 2) Blokery publikacji na npm (krytyczne)

Brak krytycznych blokerów technicznych dla publikacji.

Uwaga warunkowa (pre-release risk, nie blocker):
1. **Kompatybilność Homebridge 2.x**
   - w CI dla Homebridge beta istnieje lane `smoke`; rekomendowane jest uruchamianie pełnego zestawu testów także dla przynajmniej jednego wariantu HB 2.x stable (gdy stabilne wydanie będzie dostępne).

## 3) Ważne usprawnienia (priorytety)

### High
1. **Wzmocnić walidację konfiguracji modelu i timeoutów już na poziomie schema + runtime telemetry**
   - Dodać ostrzeżenia startupowe, gdy użytkownik ustawia skrajnie agresywne interwały (np. 1000 ms), bo może to nadmiernie obciążać urządzenie/LAN.
2. **Rozszerzyć testy kompatybilności Homebridge 2.x**
   - Co najmniej jeden job pełny (lint/typecheck/test) dla HB 2.x stable.

### Medium
1. **Lepsze rozdzielenie odpowiedzialności w `AirPurifierAccessory`**
   - Klasa jest poprawna, ale rośnie („service wiring”, mapping, cache, lifecycle). Można wydzielić binder/mapper do mniejszych modułów.
2. **Release governance**
   - Dodać jawną konfigurację semantic-release (`.releaserc`) i konwencję commitów do CONTRIBUTING, by zmniejszyć ryzyko pomyłek release’owych.
3. **Security hardening docs**
   - Dodać sekcję minimalnych uprawnień hosta i rekomendacji segmentacji sieci IoT (VLAN).

### Low
1. Dodać `.editorconfig` (spójność środowisk edycyjnych).
2. Dodać `SECURITY` workflow z okresowym `npm audit`/`npm audit signatures` i opcjonalnym `osv-scanner`.

## 4) Zgodność ze standardami Homebridge 1.x i 2.x

Ocena: **8.8/10**

### Mocne strony
- Poprawna rejestracja akcesorium przez `api.registerAccessory(...)` i spójny alias w `config.schema.json`.
- Poprawna obsługa lifecycle (`init`, polling, `shutdown`) oraz odpinanie timerów (`unref`, clearTimeout/clearInterval).
- Dobre mapowanie funkcji oczyszczacza do usług HomeKit (AirPurifier/Switch fallback, AQI, temperatury, wilgotności, filtr, child lock, LED).
- Rozsądna obsługa awarii połączeń: retry, exponential backoff z jitter, eventy connected/disconnected/reconnected.

### Do poprawy
- Utrzymać i rozszerzyć testy różnic behavioralnych dla Homebridge 2.x (nie tylko smoke).
- Rozważyć strategię adaptacyjną polling intervals (np. wydłużanie przy dłuższej niedostępności urządzenia).

## 5) Security & Supply Chain

- Nie stwierdzono logowania tokena urządzenia; token jest używany do lokalnej kryptografii MIIO.
- Komunikacja MIIO jest szyfrowana AES-128-CBC zgodnie z protokołem urządzeń Xiaomi; brak TLS jest ograniczeniem protokołu LAN, nie implementacji.
- `npm audit --audit-level=high` bez wykrytych podatności.
- Brak nieakceptowalnych deprecations: jedyny historyczny warning dotyczy `q@1.1.2` jako pochodna zależności Homebridge 1.x.
- Plusy supply-chain: lockfile obecny, Dependabot dla npm i GitHub Actions, generowanie SBOM.

## 6) Testy, CI/CD i automatyzacja

- Testy: sensowne pokrycie ścieżek krytycznych (transport, retry, mapowanie, zachowanie accessory/platform).
- Pokrycie: 100/100/100/100 dla statements/branches/functions/lines.
- Lint/typecheck: obecne i działające.
- CI: dobra macierz Node 20/22/24 + Homebridge 1.x/beta, plus audit i artifact coverage.
- Release: semantic-release + pluginy changelog/git/npm/github; podstawy profesjonalnego release flow są spełnione.

## 7) Sugestie zmian w plikach (konkret)

### `package.json`
- Rozważyć dodanie:
```json
"scripts": {
  "audit": "npm audit --audit-level=high",
  "test:ci": "vitest run --coverage"
}
```
- Rozważyć wpisanie `packageManager` (np. `npm@10.x`) dla spójności lokalnie/CI.

### `.github/workflows/ci.yml`
- Dodać przynajmniej jeden pełny lane dla Homebridge 2.x stable (po GA).
- Dodać `concurrency` aby redukować kolejki i koszty CI.

### `CONTRIBUTING.md`
- Dopisać wymagany styl commitów (Conventional Commits) + krótkie przykłady.

### `README.md`
- Dodać tabelę „HB 1.x vs 2.x compatibility notes” (np. ewentualne różnice charakterystyk i fallbacków).

## 8) Checklista „gotowe do npm”

- [x] LICENSE
- [x] README (instalacja, konfiguracja, troubleshooting)
- [x] CHANGELOG
- [x] CONTRIBUTING
- [x] CODE_OF_CONDUCT
- [x] SECURITY.md
- [x] Issue/PR templates
- [x] CI (lint/typecheck/test/audit)
- [x] Dependabot (npm + actions)
- [x] Lockfile (`package-lock.json`)
- [x] `files` w `package.json` (kontrola publikowanych artefaktów)
- [x] Keywords/homepage/repository/bugs
- [x] Engines + peerDependencies dla Homebridge
- [x] TS strict + linting
- [ ] `.editorconfig` (rekomendowane)
- [ ] Jawny dokument polityki deprecations (opcjonalne, ale zalecane)

## 9) Podsumowanie końcowe

Projekt jest bardzo blisko wzorca „high-quality OSS plugin”. Do publikacji na npm nadaje się już teraz. Najważniejsze działania po publikacji to utrzymanie pełnej walidacji HB 2.x i dalsze wzmacnianie governance release/security.
