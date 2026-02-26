# Triage rekomendacji audytowych (2026-02-26)

## [1] Główne ryzyko jakościowe dotyczy pokrycia transportu MIIO: src/core/miio-transport.ts jest wyłączony z coverage threshold 100%, co osłabia gwarancję regresji na najtrudniejszej warstwie.

- **Zasadność:** **Potwierdzony.** Konfiguracja Vitest wymusza 100% progi, ale jednocześnie jawnie wyklucza `src/core/miio-transport.ts`, więc krytyczna warstwa I/O nie jest objęta formalnym gate'em coverage.
- **Decyzja:** **SHOULD**
- **Priorytet:** **High**
- **Wpływ:** stabilność, utrzymanie OSS
- **Ryzyko regresji:** **Med** — samo dodanie testów ma niskie ryzyko, ale usunięcie wykluczenia może wymusić korekty semantyki timeoutów/retry i ujawnić kruche miejsca.
- **Jak zweryfikować:**
  1. Sprawdzić `vitest.config.ts` (`coverage.exclude`, `coverage.thresholds`).
  2. Przejrzeć istniejące testy `test/miio-transport-reliability.test.ts` i `test/reliability.test.ts` pod kątem pokrycia parsera, framingu, timeoutów i error paths.
  3. Uruchomić `vitest run --coverage` po usunięciu exclude i zidentyfikować niepokryte gałęzie.
- **Jeśli naprawiać:** Dodać testy jednostkowe/integracyjne z mockiem `dgram` pod edge-case'y (złe pakiety, timeouts, reconnect, sequence mismatch), następnie stopniowo zmniejszać/usuwać exclude dla `miio-transport.ts`.

## [2] Główne ryzyko produktowe: zadeklarowana kompatybilność z Homebridge 2.x istnieje, ale brakuje jawnego test matrix dla samej wersji Homebridge (obecnie matrix dotyczy Node.js).

- **Zasadność:** **Potwierdzony.** Repo deklaruje zgodność `homebridge: ^1.11.1 || ^2.0.0`, natomiast CI testuje jedynie macierz wersji Node.js i używa pojedynczej dev-zależności Homebridge 1.x.
- **Decyzja:** **SHOULD**
- **Priorytet:** **High**
- **Wpływ:** użytkownicy, zgodność Homebridge, utrzymanie OSS
- **Ryzyko regresji:** **Low/Med** — dodanie jobów CI ma małe ryzyko produktowe, ale może ujawnić różnice API/zachowania wymagające zmian kompatybilnościowych.
- **Jak zweryfikować:**
  1. Sprawdzić `package.json` (`engines.homebridge`, `peerDependencies.homebridge`, `devDependencies.homebridge`).
  2. Sprawdzić `.github/workflows/ci.yml` i potwierdzić brak matrix po wersji Homebridge.
  3. Dodać eksperymentalny job CI instalujący Homebridge 2.x i uruchamiający lint/typecheck/test (co najmniej na Node 22).
- **Jeśli naprawiać:** Rozszerzyć workflow o matrix `homebridge: [1.11.x, 2.x]` (przynajmniej smoke tests), utrzymać pełny zestaw testów na jednej osi (np. Node), a dla drugiej osi dodać szybkie sanity checks, by kontrolować czas CI.

## Podsumowanie przekrojowe (dla dostarczonej listy 2 pozycji)

### Top rzeczy do naprawienia natychmiast
1. Dodać jawny test matrix Homebridge 1.x/2.x w CI (wysokie ryzyko niejawnej niekompatybilności runtime).
2. Domknąć coverage krytycznej warstwy `miio-transport` i usunąć wyjątek coverage.

### Top rzeczy do odłożenia
1. Pełne E2E dla każdej kombinacji Node × Homebridge × model urządzenia (wysoki koszt CI; etapować po wdrożeniu smoke matrix).
2. Refaktoryzacje stylistyczne transportu niezwiązane z pokryciem scenariuszy błędów.

### Rzeczy do odrzucenia (WON'T)
- Brak pozycji WON'T przy obecnej liście (obie rekomendacje są merytoryczne i praktyczne).

### Ryzyka wprowadzania zmian
- Najwyższe ryzyko regresji: logika retry/timeout i parsowanie ramek w `miio-transport`.
- Ryzyko operacyjne: wydłużenie czasu CI po rozszerzeniu macierzy.

### Sugerowana kolejność prac (plan 6 kroków)
1. Dodać job CI dla Homebridge 2.x (smoke: install + typecheck + test).
2. Ustabilizować ewentualne różnice kompatybilności API/Homebridge.
3. Dodać brakujące testy transportu MIIO (edge-case first).
4. Tymczasowo mierzyć coverage `miio-transport` raportowo (bez natychmiastowego blokowania merge).
5. Usunąć `exclude` i przywrócić pełny gate coverage także dla transportu.
6. Monitorować flaky tests i dopracować timeouty w testach sieciowych.
