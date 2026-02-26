# Triage zgłoszeń (walidacja zasadności + decyzje)

> Skala: **Decyzja** = MUST/SHOULD/COULD/WON’T, **Priorytet** = Blocker/High/Medium/Low.

1. **Fix ContactSensorState logic in air-purifier.ts — enum keys were reversed (CONTACT_DETECTED/NOT_DETECTED) causing filter alert sensor to fire when filter was OK and stay silent when filter needed replacement. Also corrects the test mock to use real HAP values (CONTACT_DETECTED=0, CONTACT_NOT_DETECTED=1) which was masking the production bug.**
- Zasadność: Potwierdzony (krytyczna semantyka HAP, skutkuje odwróconym alertem).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, zgodność HomeKit
- Ryzyko regresji: Med (dotyka mapowań i testów)
- Jak zweryfikować: `src/accessory/air-purifier.ts`, `src/**/mappers*`, test E2E z filtrem 0%/100%.
- Jeśli naprawiać: Ujednolicić enum z HAP, poprawić mocki, dodać testy kontraktowe wartości 0/1.

2. **Derive unique SerialNumber from device IP address instead of "unknown", preventing HomeKit identity collisions when multiple purifiers are paired.**
- Zasadność: Potwierdzony (nieunikalny serial powoduje kolizje akcesoriów).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, stabilność, zgodność HomeKit
- Ryzyko regresji: Low
- Jak zweryfikować: `src/platform*`/`src/accessory*` generowanie `SerialNumber`; dodać test multi-device.
- Jeśli naprawiać: deterministyczny serial (np. hash IP+model), fallback gdy IP niedostępne.

3. **Fix reconnectDelayMs semantics: was incorrectly used as baseDelayMs (15 000 ms first-retry delay), now used as maxDelayMs cap so the first retry stays fast (400 ms base) and subsequent retries back off up to the configured maximum.**
- Zasadność: Potwierdzony (zła semantyka opóźnia odzyskanie połączenia).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: stabilność
- Ryzyko regresji: Med
- Jak zweryfikować: `src/**/retry*` i `config.schema.json`; test timeline retry.
- Jeśli naprawiać: rozdzielić `baseDelayMs` i `maxDelayMs`, poprawić opis w schemacie.

4. **Downgrade @types/node from ^25 to ^22 to match engines.node (^20||^22||^24)**
- Zasadność: Potwierdzony (typy mogą wyprzedzać runtime API).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json`, `npm ls @types/node`, `tsc` na Node 20/22.
- Jeśli naprawiać: przypiąć wersję zgodną z najniższym wspieranym runtime.

5. **Remove CONTRIBUTING.md from npm "files" (dev-only document)**
- Zasadność: Prawdopodobny (nie blocker, ale szum w paczce).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json#files`, `npm pack --dry-run`.
- Jeśli naprawiać: usunąć z `files`.

6. **Add 14 searchable keywords (mi, miio, miot, pm2.5, zhimi, etc.)**
- Zasadność: Prawdopodobny (lepsza discoverability).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json#keywords`.
- Jeśli naprawiać: dodać sensowne słowa bez keyword stuffing.

7. **Expand author field with GitHub url; remove -beta.0 suffix from peer/engines**
- Zasadność: Częściowo potwierdzony (`-beta` w engines/peer bywa mylące).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS, zgodność
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json` oraz instalacja pluginu w Homebridge.
- Jeśli naprawiać: uporządkować metadane i zakresy wersji.

8. **Add npm audit --audit-level=high to release.yml to gate publishes**
- Zasadność: Potwierdzony (supply-chain hardening).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: bezpieczeństwo
- Ryzyko regresji: Low
- Jak zweryfikować: `.github/workflows/release.yml` + symulacja pipeline.
- Jeśli naprawiać: osobny krok failujący dla high/critical.

9. **Split tsconfig: remove vitest/globals from production tsconfig.json, add tsconfig.test.json extending it with vitest/globals for test IDE support**
- Zasadność: Potwierdzony (higiena typów).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `tsconfig*.json`, `tsc -p tsconfig.json`, `tsc -p tsconfig.test.json`.
- Jeśli naprawiać: rozdzielić konfiguracje prod/test.

10. **Add .github/pull_request_template.md with lint/test/CHANGELOG checklist**
- Zasadność: Prawdopodobny (process improvement).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: obecność pliku i użycie w PR.
- Jeśli naprawiać: dodać krótki checklist.

11. **Update config.schema.json description for reconnectDelayMs (max cap semantics)**
- Zasadność: Potwierdzony (spójność UX konfiguracji).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy, utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `config.schema.json`.
- Jeśli naprawiać: opisać dokładnie semantykę i minimum.

12. **Full audit report written to AUDIT_REPORT.md (19 findings, 10 fixed)**
- Zasadność: Prawdopodobny (dokumentacja procesu).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: zawartość i aktualność `AUDIT_REPORT.md`.
- Jeśli naprawiać: publikować tylko jeśli nie zawiera wrażliwych danych.

13. **ContactSensorState enum odwrócony: test mock maskuje błąd produkcyjny — w prawdziwym HAP alert filtra działa odwrotnie (brak alertu gdy wymaga wymiany)**
- Zasadność: Potwierdzony (duplikat [1], ten sam bug).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, zgodność HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: jw. [1].
- Jeśli naprawiać: jw. [1].

14. **Fan speed (RotationSpeed) zaimplementowany i przetestowany, ale nigdy nie eksponowany do HomeKit — martwy kod, kluczowa funkcja oczyszczacza niedostępna**
- Zasadność: Potwierdzony (feature gap względem oczekiwań).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: użytkownicy, zgodność HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: `air-purifier` service characteristics + Home app.
- Jeśli naprawiać: podpiąć `RotationSpeed` do charakterystyki i handlerów.

15. **Brak Service.AirPurifier — używa Switch zamiast natywnego serwisu HAP, wyklucza Siri i HomeKit Automation**
- Zasadność: Potwierdzony (strategiczny błąd modelowania HAP).
- Decyzja: MUST
- Priorytet: Blocker
- Wpływ: użytkownicy, zgodność HomeKit
- Ryzyko regresji: High
- Jak zweryfikować: `src/accessory/*` i typ rejestrowanego serwisu.
- Jeśli naprawiać: migracja na `Service.AirPurifier` + mapowanie mandatory characteristics.

16. **getProperties(_props) ignoruje argument — misleading interface, 3 kanały pollingu wykonują identyczną pracę mimo różnych interwałów**
- Zasadność: Potwierdzony (strata wydajności, mylące API).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, utrzymanie OSS
- Ryzyko regresji: Med
- Jak zweryfikować: `DeviceClient#getProperties`, profile pollingu.
- Jeśli naprawiać: honorować listę props i rozdzielić kanały.

17. **Legacy protocol: 13 sekwencyjnych UDP calls zamiast batch get_prop**
- Zasadność: Potwierdzony (latencja i większa awaryjność).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: stabilność, użytkownicy
- Ryzyko regresji: Med
- Jak zweryfikować: `legacy` transport i logi RPC count.
- Jeśli naprawiać: użyć `get_prop` batch + fallback na starsze modele.

18. **@types/node@^25 niezgodne z engines.node ^20|^22|^24**
- Zasadność: Potwierdzony (duplikat [4]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [4].
- Jeśli naprawiać: jw. [4].

19. **SerialNumber "unknown" — nieunikalny przy wielu urządzeniach**
- Zasadność: Potwierdzony (duplikat [2]).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [2].
- Jeśli naprawiać: jw. [2].

20. **CONTRIBUTING.md w polu "files" (publikowane na npm)**
- Zasadność: Prawdopodobny (duplikat [5]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [5].
- Jeśli naprawiać: jw. [5].

21. **LED mapping niespójność: MIOT (toNumber !== 2) vs Legacy (toBoolean)**
- Zasadność: Potwierdzony (niespójne zachowanie między protokołami).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy, zgodność
- Ryzyko regresji: Med
- Jak zweryfikować: mapowania LED w obu clientach + testy parametryzowane.
- Jeśli naprawiać: zdefiniować jednoznaczną semantykę i adapter per protokół.

22. **reconnectDelayMs semantycznie myli: faktycznie to baseDelayMs backoff**
- Zasadność: Potwierdzony (duplikat [3]).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: stabilność
- Ryzyko regresji: Med
- Jak zweryfikować: jw. [3].
- Jeśli naprawiać: jw. [3].

23. **Confirmed ContactSensorState semantics bug (CONTACT_DETECTED/CONTACT_NOT_DETECTED inverted in production vs HAP spec; test fake masks the bug with swapped values)**
- Zasadność: Potwierdzony (duplikat [1]/[13]).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: jw. [1].
- Jeśli naprawiać: jw. [1].

24. **Dead code identified: fanLevelToRotationSpeed, rotationSpeedToFanLevel, setFanLevel, setBuzzerVolume — implemented, tested, exported but never wired to HomeKit**
- Zasadność: Potwierdzony (wartość funkcjonalna marnowana).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS, użytkownicy
- Ryzyko regresji: Med
- Jak zweryfikować: wyszukanie referencji metod i charakterystyk.
- Jeśli naprawiać: albo podłączyć do HomeKit, albo usunąć.

25. **miio-transport.ts (648 lines) excluded from coverage — highest-risk module with crypto, UDP, session management, dual-protocol fallback has zero regression safety**
- Zasadność: Potwierdzony (obszar najwyższego ryzyka bez testów).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: stabilność, bezpieczeństwo pośrednio
- Ryzyko regresji: Med
- Jak zweryfikować: `vitest.config*`, raport coverage.
- Jeśli naprawiać: wydzielać pure functions i dodać testy jednostkowe/integracyjne.

26. **AQI=0 returns Excellent instead of HAP UNKNOWN when device state unavailable**
- Zasadność: Potwierdzony (zła semantyka unavailable).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy, zgodność HAP
- Ryzyko regresji: Low
- Jak zweryfikować: mapper AQI dla `0/null/undefined`.
- Jeśli naprawiać: rozróżnić „0 jako pomiar” vs „brak danych”.

27. **Double decryption per RPC in sendAndReceive + sendCommand**
- Zasadność: Potwierdzony (wydajność + potencjalne błędy przy refaktorze).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, wydajność
- Ryzyko regresji: Med
- Jak zweryfikować: flow decrypt w `miio-transport` i benchmark.
- Jeśli naprawiać: pojedyncza odpowiedzialność: decrypt tylko raz.

28. **GitHub Actions not pinned to commit SHA (supply-chain risk)**
- Zasadność: Potwierdzony (hardening CI).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: bezpieczeństwo
- Ryzyko regresji: Low
- Jak zweryfikować: workflow uses `@vX` vs SHA.
- Jeśli naprawiać: pin kluczowe akcje do SHA + okresowe update.

29. **Missing fail-fast: false in CI matrix strategy**
- Zasadność: Prawdopodobny (wygoda diagnostyczna, nie bug).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `strategy.fail-fast`.
- Jeśli naprawiać: ustawić `false` dla pełnych wyników.

30. **Homebridge AccessoryPlugin vs DynamicPlatformPlugin compatibility notes**
- Zasadność: Prawdopodobny (dokumentacyjnie przydatne).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: README + API usage.
- Jeśli naprawiać: dopisać sekcję kompatybilności.

31. **Concrete fix proposals for all HIGH/MEDIUM issues with code examples**
- Zasadność: Prawdopodobny (wartość dla maintainera).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: jakość i aktualność propozycji.
- Jeśli naprawiać: trzymać w ADR/audyt docs.

32. **Full npm-readiness checklist (pass/fail for 40+ items)**
- Zasadność: Prawdopodobny (proces jakości).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: checklist vs repo status.
- Jeśli naprawiać: utrzymywać jako release artifact.

33. **Homebridge 1.x/2.x compatibility scoring (8/10) with per-criterion table**
- Zasadność: Wątpliwy (metryka subiektywna, nie techniczny problem).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: realne testy compatibility zamiast scoringu.
- Jeśli naprawiać: zastąpić macierzą testów kompatybilności.

34. **All previous findings verified as resolved (LICENSE, biome, onGet, unref, etc.)**
- Zasadność: Wątpliwy (to twierdzenie statusowe, nie problem).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: brak
- Ryzyko regresji: Low
- Jak zweryfikować: `git log`, pliki wskazane.
- Jeśli naprawiać: nie dotyczy.

35. **New finding: Switch vs native HAP AirPurifier service (HIGH-1)**
- Zasadność: Potwierdzony (duplikat [15]).
- Decyzja: MUST
- Priorytet: Blocker
- Wpływ: HomeKit
- Ryzyko regresji: High
- Jak zweryfikować: jw. [15].
- Jeśli naprawiać: jw. [15].

36. **New finding: dead code - unused mappers and DeviceClient methods (HIGH-2)**
- Zasadność: Potwierdzony (duplikat [24]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie
- Ryzyko regresji: Med
- Jak zweryfikować: jw. [24].
- Jeśli naprawiać: jw. [24].

37. **New finding: double decryption in sendAndReceive/sendCommand (MED-1)**
- Zasadność: Potwierdzony (duplikat [27]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: wydajność
- Ryzyko regresji: Med
- Jak zweryfikować: jw. [27].
- Jeśli naprawiać: jw. [27].

38. **New finding: missing PM2_5Density characteristic (MED-2)**
- Zasadność: Potwierdzony (brak kluczowej characteristic dla oczyszczacza).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: użytkownicy, HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: czy `PM2_5Density` jest wystawione i aktualizowane.
- Jeśli naprawiać: dodać characteristic oraz mapowanie z czujnika.

39. **Updated compliance score: 18/18, overall quality: 9.3/10**
- Zasadność: Wątpliwy (to raport, nie defekt).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: brak
- Ryzyko regresji: Low
- Jak zweryfikować: metodologia scoringu.
- Jeśli naprawiać: nie dotyczy.

40. **No publication blockers — plugin is ready for npm**
- Zasadność: Wątpliwy (stwierdzenie, nie zadanie).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: proces
- Ryzyko regresji: Low
- Jak zweryfikować: checklist + CI green + smoke test.
- Jeśli naprawiać: nie dotyczy.

41. **Upgrade @biomejs/biome from 2.4.3 to 2.4.4 (fixes schema mismatch)**
- Zasadność: Prawdopodobny (narzędziowe).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `biome check`.
- Jeśli naprawiać: bump + lockfile update.

42. **Extract miio-transport pure functions (toBoolean, toNumber, toMode) into miio-converters.ts with 9 dedicated unit tests for full coverage**
- Zasadność: Prawdopodobny (testowalność i separacja).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, utrzymanie
- Ryzyko regresji: Med
- Jak zweryfikować: coverage diff i testy mapperów.
- Jeśli naprawiać: wydzielić pure layer bez zmiany API runtime.

43. **Add onGet handlers for all readable HomeKit characteristics so HomeKit reads always return the latest cached state**
- Zasadność: Potwierdzony (w Homebridge to dobra praktyka).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: użytkownicy, zgodność HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: wszystkie `Characteristic` mają `onGet`/cache.
- Jeśli naprawiać: centralny cache state + spójne onGet.

44. **Replace all Reflect.get/Reflect.set usage with idiomatic TypeScript property access patterns (type assertions with `as`)**
- Zasadność: Wątpliwy (głównie styl; Reflect bywa uzasadniony).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: kosmetyka
- Ryzyko regresji: Med (masowy refaktor)
- Jak zweryfikować: czy Reflect rozwiązuje dynamiczny dostęp.
- Jeśli naprawiać: tylko punktowo tam, gdzie poprawia typowanie.

45. **Add .unref() to all polling timers so they don't prevent graceful Node.js process shutdown**
- Zasadność: Potwierdzony (ważne dla shutdown Homebridge).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, zgodność runtime
- Ryzyko regresji: Low
- Jak zweryfikować: test zamknięcia procesu po `stop`.
- Jeśli naprawiać: `setInterval(...).unref()` dla pollingu.

46. **Wrap nextMessageId with modulo to prevent Number overflow**
- Zasadność: Prawdopodobny (długoterminowa niezawodność).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: stabilność
- Ryzyko regresji: Low
- Jak zweryfikować: test długiego biegu/liczników.
- Jeśli naprawiać: modulo 2^31-1 i ochrona przed 0.

47. **Expose operationPollIntervalMs and sensorPollIntervalMs in config schema for advanced users**
- Zasadność: Prawdopodobny (feature request).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: użytkownicy zaawansowani
- Ryzyko regresji: Med
- Jak zweryfikować: schema + walidacja minimów.
- Jeśli naprawiać: dodać pola z bezpiecznymi limitami.

48. **Remove unused .gitkeep file**
- Zasadność: Prawdopodobny (porządek repo).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: czy katalog pozostaje potrzebny.
- Jeśli naprawiać: usunąć jeśli katalog nie musi istnieć.

49. **Fix RELEASE_CHECKLIST.md to reference correct release script names**
- Zasadność: Potwierdzony (spójność procesu release).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: checklist vs `package.json scripts`.
- Jeśli naprawiać: zsynchronizować nazwy.

50. **Add convenience "check" script to package.json**
- Zasadność: Prawdopodobny (DX).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: `npm run check`.
- Jeśli naprawiać: agregacja lint+test+typecheck.

51. **Add .npmrc with engine-strict=true**
- Zasadność: Prawdopodobny (egzekwowanie zgodności Node).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: instalacja na niewspieranym Node powinna failować.
- Jeśli naprawiać: dodać i opisać w README.

52. **Requirements: fix Node.js version range from overly specific patch versions (20.20+/22.22+/24.13+) to major ranges (20+/22+/24+)**
- Zasadność: Potwierdzony (zbyt restrykcyjne engines bez technicznej potrzeby).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json engines` + testy na minimalnych wersjach.
- Jeśli naprawiać: ustawić `^20.0.0 || ^22.0.0 || ^24.0.0`.

53. **Features table: add Hazardous (level 5) to AQI description and list Filter Replace Alert as an optional service**
- Zasadność: Prawdopodobny (dokładność dokumentacji).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie/docs
- Ryzyko regresji: Low
- Jak zweryfikować: README vs kod mappera AQI.
- Jeśli naprawiać: zaktualizować tabelę.

54. **AQI mapping table: update thresholds to match code (36–75 Good, 76–115 Fair, 116–150 Poor, >150 Hazardous); was missing level 5**
- Zasadność: Potwierdzony jeśli kod już tak działa; inaczej bug kodu/docs.
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy, docs
- Ryzyko regresji: Low
- Jak zweryfikować: mapper AQI + README tabela.
- Jeśli naprawiać: wyrównać kod i dokumentację.

55. **Mode switches: add table showing ON/OFF states for AUTO and NIGHT**
- Zasadność: Prawdopodobny (lepsza dokumentacja).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: README.
- Jeśli naprawiać: dodać prostą tabelę.

56. **Filter section: expand into table (FilterLifeLevel, FilterChangeIndication, ContactSensorState); clarify exposeFilterReplaceAlertSensor use case**
- Zasadność: Prawdopodobny (przejrzystość zachowania).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs, użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: README sekcja filter.
- Jeśli naprawiać: dopisać tabelę i przykłady.

57. **Polling: convert prose to table with channel, interval and purpose**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: README.
- Jeśli naprawiać: dodać tabelę.

58. **Troubleshooting: add static IP tip, increase timeout tip, hex format note**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: README troubleshooting.
- Jeśli naprawiać: dopisać checklistę.

59. **Development: add lint:fix command; replace single 'release' script with release:patch / release:minor / release:major; note automated publish**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json scripts`.
- Jeśli naprawiać: dodać skrypty i zaktualizować docs.

60. **Config fields table: add min value notes for timeout/interval fields**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs/użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: README + schema minima.
- Jeśli naprawiać: zsynchronizować z `config.schema.json`.

61. **Supported models: note automatic protocol detection fallback for unlisted models**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: logika detekcji protokołu.
- Jeśli naprawiać: dopisać ograniczenia fallback.

62. **Token section: add hex format example and security warning**
- Zasadność: Potwierdzony (bezpieczeństwo + redukcja błędów konfiguracyjnych).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: bezpieczeństwo, użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: README/security docs.
- Jeśli naprawiać: krótki przykład i warning.

63. **Requirements: fix Node.js version range from overly specific patch versions (20.20+/22.22+/24.13+) to major ranges (20+/22+/24+)**
- Zasadność: Potwierdzony (duplikat [52]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [52].
- Jeśli naprawiać: jw. [52].

64. **Features table: add Hazardous (level 5) to AQI description and list Filter Replace Alert as an optional service**
- Zasadność: Prawdopodobny (duplikat [53]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [53].
- Jeśli naprawiać: jw. [53].

65. **AQI mapping table: update thresholds to match code (36–75 Good, 76–115 Fair, 116–150 Poor, >150 Hazardous); was missing level 5**
- Zasadność: Potwierdzony (duplikat [54]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: docs/użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [54].
- Jeśli naprawiać: jw. [54].

66. **Mode switches: add table showing ON/OFF states for AUTO and NIGHT**
- Zasadność: Prawdopodobny (duplikat [55]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [55].
- Jeśli naprawiać: jw. [55].

67. **Filter section: expand into table (FilterLifeLevel, FilterChangeIndication, ContactSensorState); clarify exposeFilterReplaceAlertSensor use case**
- Zasadność: Prawdopodobny (duplikat [56]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [56].
- Jeśli naprawiać: jw. [56].

68. **Polling: convert prose to table with channel, interval and purpose**
- Zasadność: Prawdopodobny (duplikat [57]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [57].
- Jeśli naprawiać: jw. [57].

69. **Troubleshooting: add static IP tip, increase timeout tip, hex format note**
- Zasadność: Prawdopodobny (duplikat [58]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [58].
- Jeśli naprawiać: jw. [58].

70. **Development: add lint:fix command; replace single 'release' script with release:patch / release:minor / release:major; note automated publish**
- Zasadność: Prawdopodobny (duplikat [59]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: process
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [59].
- Jeśli naprawiać: jw. [59].

71. **Config fields table: add min value notes for timeout/interval fields**
- Zasadność: Prawdopodobny (duplikat [60]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [60].
- Jeśli naprawiać: jw. [60].

72. **Supported models: note automatic protocol detection fallback for unlisted models**
- Zasadność: Prawdopodobny (duplikat [61]).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: docs
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [61].
- Jeśli naprawiać: jw. [61].

73. **Token section: add hex format example and security warning**
- Zasadność: Potwierdzony (duplikat [62]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: bezpieczeństwo
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [62].
- Jeśli naprawiać: jw. [62].

74. **ci: bump actions/checkout, setup-node, upload-artifact to @v4 (were @v6, non-existent versions – CI was completely broken)**
- Zasadność: Potwierdzony jeśli rzeczywiście użyto `@v6` (to błąd krytyczny CI).
- Decyzja: MUST
- Priorytet: Blocker
- Wpływ: utrzymanie OSS/release
- Ryzyko regresji: Low
- Jak zweryfikować: `.github/workflows/*.yml` wersje akcji, odpalenie CI.
- Jeśli naprawiać: poprawić do istniejących wersji i/lub SHA pinning.

75. **package.json: widen `engines.node` from over-specific patch versions (^20.20.0 || ^22.22.0 || ^24.13.0) to `^20.0.0 || ^22.0.0 || ^24.0.0`**
- Zasadność: Potwierdzony (duplikat [52]).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: `package.json` i matrix CI.
- Jeśli naprawiać: jw. [52].

76. **changelog: promote [Unreleased] to [1.0.0] – 2026-02-25 with full initial release notes**
- Zasadność: Prawdopodobny (proces release).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: `CHANGELOG.md`.
- Jeśli naprawiać: zsynchronizować z tagiem.

77. **ci: add release.yml workflow for automated npm publish on version tags**
- Zasadność: Prawdopodobny (usprawnienie wydawnicze).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Med
- Jak zweryfikować: workflow + test dry-run publish.
- Jeśli naprawiać: dodać workflow z zabezpieczeniami.

78. **platform: validate token is 32-char hex at config time (assertHexToken); previously only a non-empty string check was performed**
- Zasadność: Potwierdzony (walidacja wejścia, mniejsza liczba błędów runtime).
- Decyzja: MUST
- Priorytet: High
- Wpływ: bezpieczeństwo, stabilność, użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: walidator config + testy tokenu.
- Jeśli naprawiać: regex hex i czytelny komunikat błędu.

79. **config.schema.json: fix token pattern `^\w{32}$` → `^[0-9a-fA-F]{32}$`**
- Zasadność: Potwierdzony (obecny regex dopuszcza `_` i niehex).
- Decyzja: MUST
- Priorytet: High
- Wpływ: bezpieczeństwo/użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: schema validation przypadków negatywnych.
- Jeśli naprawiać: poprawić pattern i opis.

80. **retry: remove EADDRINUSE / EADDRNOTAVAIL from retryable error codes; these are local socket binding errors – retrying is pointless and could mask misconfiguration**
- Zasadność: Potwierdzony (zła klasyfikacja błędów).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, diagnowalność
- Ryzyko regresji: Low
- Jak zweryfikować: tablica retryable codes + test integracyjny.
- Jeśli naprawiać: usunąć z retry listy i logować jako konfiguracja.

81. **mappers: fix inverted fanLevelToRotationSpeed / rotationSpeedToFanLevel (fan_level 16 was mapping to 0 % rotation – backwards)**
- Zasadność: Potwierdzony (bug użytkowy mapowania).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, HomeKit
- Ryzyko regresji: Med
- Jak zweryfikować: testy graniczne mapowania 0/1/16/max.
- Jeśli naprawiać: odwrócić skalę i zsynchronizować testy.

82. **mappers: add AQI Hazardous level 5 (>150 μg/m³); previously capped at 4**
- Zasadność: Potwierdzony (zgodność z HAP i poprawna klasyfikacja).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: testy wszystkich progów AQI.
- Jeśli naprawiać: dodać poziom 5 oraz docs.

83. **miio-transport: accept optional MiioTransportLogger; route suppressed errors through logger.debug() when available, fall back to process.emitWarning() for backward compatibility**
- Zasadność: Prawdopodobny (lepsza obserwowalność).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie/stabilność
- Ryzyko regresji: Med
- Jak zweryfikować: logowanie błędów transportu w Homebridge.
- Jeśli naprawiać: wstrzykiwany logger z fallbackiem.

84. **platform: pass Homebridge Logging to ModernMiioTransport so transport errors appear in Homebridge logs**
- Zasadność: Potwierdzony (operacyjna diagnowalność).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie/stabilność
- Ryzyko regresji: Low
- Jak zweryfikować: test manualny logów przy timeout.
- Jeśli naprawiać: przekazać `log` w konstruktorze transportu.

85. **biome.json: add lineWidth 100, explicit indentWidth 2**
- Zasadność: Prawdopodobny (spójność stylu).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: `biome check`.
- Jeśli naprawiać: ustawić i zatwierdzić format.

86. **auto-apply biome formatter across all source and test files**
- Zasadność: Prawdopodobny (higiena repo), ale duży churn.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Med (konflikty merge)
- Jak zweryfikować: diff bez zmian semantycznych.
- Jeśli naprawiać: osobny PR „format-only”.

87. **package.json: add `"type": "commonjs"`, `prepare` script, split release into release:patch / release:minor / release:major**
- Zasadność: Częściowo potwierdzony (`type` bywa przydatne, ale nie zawsze wymagane).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Med (module resolution)
- Jak zweryfikować: build + uruchomienie pluginu.
- Jeśli naprawiać: wdrażać ostrożnie i testować CJS behavior.

88. **config.schema.json: fix empty Sensors section; move filter options into "Sensors & Alerts" section**
- Zasadność: Potwierdzony (UX Homebridge Config UI).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: render sekcji w UI.
- Jeśli naprawiać: poprawić layout schema.

89. **remove AUDIT_REPORT.md from public repository**
- Zasadność: Wątpliwy (zależy od treści; zwykle transparentność jest plusem).
- Decyzja: WON’T
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: czy raport zawiera wrażliwe dane.
- Jeśli naprawiać: usuwać tylko jeśli ujawnia ryzyka exploitable.

90. **add .editorconfig for cross-editor consistency**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: obecność pliku i zgodność z formatterem.
- Jeśli naprawiać: dodać minimalny zestaw reguł.

91. **add .github/ISSUE_TEMPLATE/ (bug_report.yml, feature_request.yml, config.yml) with required environment fields**
- Zasadność: Prawdopodobny.
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: tworzenie issue na GitHub.
- Jeśli naprawiać: dodać lekkie szablony.

92. **ci: add `if: always()` to coverage artifact upload step**
- Zasadność: Potwierdzony (debug po failu testów).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie CI
- Ryzyko regresji: Low
- Jak zweryfikować: workflow po celowym failu.
- Jeśli naprawiać: dodać warunek do upload step.

93. **mappers.test.ts: update assertions to reflect corrected fan level direction; add boundary tests for all 5 AQI levels including Hazardous**
- Zasadność: Potwierdzony (testy muszą odzwierciedlać nową semantykę).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność
- Ryzyko regresji: Low
- Jak zweryfikować: uruchomić testy mapperów.
- Jeśli naprawiać: uzupełnić testy graniczne.

94. **accessory-platform-index.test.ts: add test for invalid-hex token validation (new assertHexToken branch coverage)**
- Zasadność: Potwierdzony (pokrycie nowej walidacji).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność
- Ryzyko regresji: Low
- Jak zweryfikować: test negatywny tokenu.
- Jeśli naprawiać: dodać test branch.

95. **reliability.test.ts: remove EADDRINUSE / EADDRNOTAVAIL from the retryable-codes integration test**
- Zasadność: Potwierdzony (spójność testów z logiką retry).
- Decyzja: SHOULD
- Priorytet: Low
- Wpływ: utrzymanie testów
- Ryzyko regresji: Low
- Jak zweryfikować: test reliability.
- Jeśli naprawiać: zaktualizować oczekiwania testu.

96. **fix(schema): remove 5 unimplemented config fields (enableAirQuality, enableTemperature, enableHumidity, enableFanSpeedControl, enableChildLockControl) from config.schema.json and layout — these were visible in Homebridge UI but had zero effect in code**
- Zasadność: Potwierdzony (wprowadzanie użytkownika w błąd).
- Decyzja: MUST
- Priorytet: High
- Wpływ: użytkownicy, zgodność Homebridge
- Ryzyko regresji: Low
- Jak zweryfikować: schema vs kod feature flags.
- Jeśli naprawiać: usunąć/zaimplementować — preferencyjnie usunąć jeśli brak wsparcia.

97. **fix(platform): add runtime warning for unrecognized device model with VALID_MODELS constant and log.warn(); add test coverage for this branch**
- Zasadność: Potwierdzony (lepsza diagnowalność i wsparcie użytkownika).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie/użytkownicy
- Ryzyko regresji: Low
- Jak zweryfikować: model spoza listy -> warning.
- Jeśli naprawiać: dodać walidację i test.

98. **fix(transport): wrap JSON.parse in try/catch in sendCommand() to give a descriptive error on malformed device response (was bare SyntaxError)**
- Zasadność: Potwierdzony (obsługa błędów I/O).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: stabilność, diagnowalność
- Ryzyko regresji: Low
- Jak zweryfikować: zasymulować uszkodzony payload.
- Jeśli naprawiać: rzucać błąd domenowy z kontekstem.

99. **fix(deps): explicitly add homebridge@^1.11.1 to devDependencies so the peer dep is declared and pinned, not relying on npm 7+ auto-install only**
- Zasadność: Potwierdzony (deterministyczne środowisko deweloperskie).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: clean install + testy.
- Jeśli naprawiać: dopisać do devDependencies.

100. **fix(ci): add npm audit --audit-level=high job to CI pipeline**
- Zasadność: Potwierdzony (duplikat [8]).
- Decyzja: SHOULD
- Priorytet: High
- Wpływ: bezpieczeństwo
- Ryzyko regresji: Low
- Jak zweryfikować: jw. [8].
- Jeśli naprawiać: jw. [8].

101. **fix(release): correct RELEASE_CHECKLIST.md coverage thresholds from 80%/70% to the actual 100% enforced by vitest.config.ts**
- Zasadność: Potwierdzony (niespójny proces quality gate).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `RELEASE_CHECKLIST.md` vs `vitest.config.ts`.
- Jeśli naprawiać: wyrównać wartości.

102. **fix(package): remove RELEASE_CHECKLIST.md from files field (internal doc) and add LICENSE which was missing; replace with LICENSE entry**
- Zasadność: Potwierdzony (LICENSE w paczce jest ważne prawnie).
- Decyzja: MUST
- Priorytet: High
- Wpływ: compliance OSS
- Ryzyko regresji: Low
- Jak zweryfikować: `npm pack --dry-run` i zawartość paczki.
- Jeśli naprawiać: poprawić `files`.

103. **fix(test): rename duplicate test description in accessory-platform-index to unique name to aid test report diagnostics**
- Zasadność: Prawdopodobny (lepsza diagnostyka, nie blocker).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie testów
- Ryzyko regresji: Low
- Jak zweryfikować: raport testów.
- Jeśli naprawiać: unikalne nazwy test case.

104. **docs(security): add SECURITY.md with vulnerability reporting process and token security guidance**
- Zasadność: Potwierdzony (standard OSS bezpieczeństwa).
- Decyzja: SHOULD
- Priorytet: Medium
- Wpływ: bezpieczeństwo, utrzymanie OSS
- Ryzyko regresji: Low
- Jak zweryfikować: obecność i treść `SECURITY.md`.
- Jeśli naprawiać: dodać politykę zgłoszeń.

105. **docs(conduct): add CODE_OF_CONDUCT.md (Contributor Covenant v2.1)**
- Zasadność: Prawdopodobny (standard projektu OSS).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: community/process
- Ryzyko regresji: Low
- Jak zweryfikować: obecność dokumentu.
- Jeśli naprawiać: dodać standardowy szablon.

106. **docs(audit): add AUDIT_REPORT.md with full code review findings, remaining recommendations and npm-ready checklist**
- Zasadność: Prawdopodobny (duplikat [12], potencjalnie użyteczne).
- Decyzja: COULD
- Priorytet: Low
- Wpływ: utrzymanie
- Ryzyko regresji: Low
- Jak zweryfikować: aktualność i brak wrażliwych danych.
- Jeśli naprawiać: publikować wersję zsanityzowaną.

## Podsumowanie

### Top 5 rzeczy do naprawienia natychmiast
1. Migracja `Switch` -> `Service.AirPurifier` (zgodność HomeKit, Siri/Automation).
2. Naprawa `ContactSensorState` (odwrócona semantyka alarmu filtra).
3. Unikalny `SerialNumber` (kolizje wielu urządzeń).
4. Naprawa mapowania `fanLevel <-> RotationSpeed` (realna kontrola prędkości).
5. Walidacja tokenu hex + poprawny pattern w schema (błędy konfiguracji i bezpieczeństwo).

### Top 5 rzeczy do odłożenia
1. Masowe formatowanie całego repo (duży churn, niski wpływ runtime).
2. Rozbudowane tabele docs (wartościowe, ale nie krytyczne).
3. PR/Issue templates (process quality, niski wpływ użytkownika końcowego).
4. `check` script / `lint:fix` convenience (DX improvement).
5. `.editorconfig` (higiena, ale nie blocker).

### Rzeczy do odrzucenia (WON’T)
- „Homebridge 1.x/2.x compatibility scoring (8/10)…” — metryka subiektywna.
- „All previous findings verified as resolved…” — status, nie problem.
- „Updated compliance score: 18/18…” — status, nie problem.
- „No publication blockers — plugin is ready for npm” — deklaracja, nie zadanie.
- „Replace all Reflect.get/Reflect.set…” — overengineering, ryzyko przy małej wartości.
- „remove AUDIT_REPORT.md from public repository” — tylko gdy ujawnia poufne dane.

### Ryzyka wprowadzania zmian
- Największe: migracja do `Service.AirPurifier`, mapowania HAP/miot, retry semantics i warstwa transportu (UDP/crypto).
- Średnie: zmiany config schema i walidacji (mogą złamać istniejące konfiguracje bez migracji).
- Niskie: dokumentacja, metadane npm, workflow hardening.

### Sugestia kolejności prac (plan)
1. Naprawy krytyczne HAP (`AirPurifier`, `ContactSensorState`, `RotationSpeed`).
2. Tożsamość akcesorium (`SerialNumber`) + migracja użytkowników.
3. Walidacja wejścia (`token`) + schema cleanup (usuń niezaimplementowane pola).
4. Retry/transport hardening (`reconnectDelay`, retryable codes, parse errors, logging).
5. PM2.5/AQI semantyka + testy graniczne.
6. CI blockers (`actions` versions, audit job, release workflow, artifact always upload).
7. Pokrycie testami transportu i mapperów.
8. Dopiero potem porządki docs/process.
