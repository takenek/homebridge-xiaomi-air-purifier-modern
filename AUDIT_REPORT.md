# Homebridge Plugin Audit Report

## homebridge-xiaomi-air-purifier-modern v1.0.0

**Data audytu:** 2026-02-28
**Audytor:** Claude (AI-assisted review)
**Zakres:** Pełny code review, security audit, jakość kodu, zgodność Homebridge, gotowość npm

---

## 1. Executive Summary

### Największe plusy

1. **Zero runtime dependencies** — wtyczka opiera się wyłącznie na Node.js built-ins (`node:crypto`, `node:dgram`, `node:events`). To absolutny złoty standard w ekosystemie Homebridge, eliminujący ryzyko supply chain niemal w 100%.

2. **100% pokrycie kodu testami** (statements, branches, functions, lines) — wymuszone progami w `vitest.config.ts` z polityką `thresholds: 100` — bardzo rzadkie w ekosystemie Homebridge.

3. **Profesjonalny pipeline CI/CD** — semantyczny release, provenance npm, SBOM CycloneDX, OSV Scanner, Dependabot (npm + GitHub Actions), npm audit w CI, macierzowy test na Node 20/22/24 + Homebridge 1.x/beta.

4. **Solidna architektura** — czytelny podział na warstwy (transport → device-client → accessory → platform), pattern Observer dla aktualizacji stanu, operacja queue serializująca dostęp do urządzenia, retry z exponential backoff + jitter.

5. **Pełna dokumentacja OSS** — README z konfiguracją/troubleshooting, config.schema.json z layoutem, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md z SLA, issue/PR templates, RELEASE_CHECKLIST, LICENSE (MIT).

6. **Kompatybilność Homebridge 1.x / 2.x** — dynamiczna detekcja `AirPurifier` service z graceful fallback na `Switch`, poprawne `peerDependencies`, testowane w CI z obu wersjami.

### Największe ryzyka

1. **Brak `.npmignore` (ale `files` field jest poprawny)** — obecne podejście z `"files"` w package.json jest wystarczające i nawet zalecane; ryzyko niskie.

2. **`pluginType: "accessory"` zamiast `"platform"`** — to jest celowa decyzja architektoniczna (accessory-per-device), ale ogranicza automatyczne discovery i multi-device management. Nie jest to błąd, ale warto rozważyć migrację do platform w przyszłości.

3. **Brak source maps w dist** — utrudnia debugowanie stacktraców w produkcji; niskoriorytetowe.

4. **Kilka drobnych usprawnień do rozważenia** — opisane szczegółowo poniżej.

---

## 2. Analiza struktury projektu

```
xiaomi-mi-air-purifier-ng/
├── src/
│   ├── index.ts                   # Entry point — registerAccessory
│   ├── platform.ts                # Config validation, wiring
│   ├── accessories/
│   │   └── air-purifier.ts        # HomeKit service/characteristic mapping
│   └── core/
│       ├── device-client.ts       # State management, polling, retry, queue
│       ├── miio-transport.ts      # MIIO/MIOT UDP protocol implementation
│       ├── mappers.ts             # Fan level ↔ rotation speed, AQI mapping
│       ├── mode-policy.ts         # Auto/Night mode switch logic
│       ├── retry.ts               # Exponential backoff, retryable error codes
│       └── types.ts               # TypeScript types, ReadProperty list
├── test/                          # 9 test files, 84 tests
├── .github/
│   ├── workflows/                 # ci.yml, release.yml, supply-chain.yml
│   ├── dependabot.yml
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── config.schema.json             # Homebridge UI schema
├── biome.json                     # Linter/formatter config
├── tsconfig.json / tsconfig.test.json
├── vitest.config.ts
├── .releaserc.json                # semantic-release config
├── .editorconfig / .npmrc / .gitignore
├── package.json / package-lock.json
├── CHANGELOG.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md
├── LICENSE / SECURITY.md / RELEASE_CHECKLIST.md
└── README.md
```

**Ocena struktury: Doskonała** — czysty podział na warstwy, SRP przestrzegane, moduły mają jasne odpowiedzialności.

---

## 3. Zgodność ze standardami Homebridge 1.x i 2.x

### 3.1 Rejestracja wtyczki

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `registerAccessory` | OK | `src/index.ts:9` — poprawne `export =` z `(api: API) => void` |
| `pluginAlias` match | OK | `config.schema.json:2` alias `XiaomiMiAirPurifier` = `ACCESSORY_NAME` w `platform.ts:13` |
| `pluginType: "accessory"` | OK | Celowy wybór; każdy oczyszczacz = osobna entry w `accessories[]` |
| `displayName` | OK | Ustawione w `package.json:72` |

### 3.2 Lifecycle management

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Init (constructor) | OK | Asynchroniczny init z `void client.init()` + catch — nie blokuje konstruktora |
| Shutdown | OK | `api.on("shutdown", ...)` w `air-purifier.ts:137` — czyści timery + zamyka socket |
| Timer cleanup | OK | `clearTimers()` w `device-client.ts:278-301` czyści wszystkie 4 timery |
| Timer unref | OK | Wszystkie timery mają `.unref()` — nie blokują graceful shutdown Node.js |
| Error isolation | OK | Shutdown i init errors logowane, nie propagowane |

### 3.3 Obsługa restartów i reconnect

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Exponential backoff | OK | `retry.ts` z base 400ms, max 30s, 8 retries, 20% jitter |
| Retryable error codes | OK | 16 kodów sieciowych w `RETRYABLE_ERROR_CODES` |
| Connection events | OK | connected/disconnected/reconnected z logowaniem |
| Handshake retry | OK | `call()` automatycznie robi re-handshake po transport error |
| No timer leaks | OK | Test `[S5]` potwierdza `getTimerCount() === 0` po shutdown |

### 3.4 Mapowanie HomeKit

| Oczyszczacz → HomeKit | Status | Komentarz |
|----------------------|--------|-----------|
| Power ON/OFF | OK | `Active`/`CurrentAirPurifierState` (HB 2.x) lub `Switch` (HB 1.x) |
| RotationSpeed | OK | Fan level 1-16 ↔ 0-100% z poprawnym round-trip |
| TargetAirPurifierState | OK | auto ↔ manual |
| AirQuality + PM2.5 | OK | 5-stopniowa skala AQI z progami |
| Temperature | OK | `CurrentTemperature` |
| Humidity | OK | `CurrentRelativeHumidity` |
| Filter Maintenance | OK | `FilterLifeLevel` + `FilterChangeIndication` |
| Child Lock | OK | Opcjonalny Switch |
| LED | OK | Switch |
| Mode AUTO/NIGHT | OK | Dedykowane switche z logiką power-guard |

### 3.5 Kompatybilność wersji

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `engines.homebridge` | OK | `^1.11.1 \|\| ^2.0.0` |
| `peerDependencies.homebridge` | OK | Identyczne z engines |
| `engines.node` | OK | `^20.0.0 \|\| ^22.0.0 \|\| ^24.0.0` |
| CI matrix | OK | Node 20/22/24 × Homebridge 1.11.2/beta |
| `AirPurifier` service detection | OK | `Reflect.get()` graceful fallback |
| `ConfiguredName` detection | OK | Dynamiczne sprawdzanie dostępności |

### Ocena zgodności Homebridge: **9.5/10**

Jedyne zalecenie: rozważyć migrację z `accessory` na `platform` pluginType w przyszłej wersji major, co umożliwi automatyczne discovery wielu urządzeń.

---

## 4. Jakość kodu (Node.js/TypeScript)

### 4.1 Typowanie TypeScript

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| `strict: true` | OK | `tsconfig.json:9` |
| `noImplicitAny` | OK | Podwójne zabezpieczenie |
| `noUnusedLocals/Parameters` | OK | |
| `noUncheckedIndexedAccess` | OK | Doskonałe — rzadko widziane |
| `exactOptionalPropertyTypes` | OK | Bardzo restrykcyjne |
| `noExplicitAny` (Biome) | OK | `"error"` level w biome.json |
| Target | OK | ES2022 — odpowiednie dla Node 20+ |

**Ocena typowania: Wzorcowa** — jedne z najostrzejszych ustawień TS w ekosystemie.

### 4.2 Asynchroniczność i obsługa błędów

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| async/await consistency | OK | Brak mieszania callbacks z promises |
| Operation queue | OK | `enqueueOperation` serializuje dostęp do transport |
| Queue error isolation | OK | Previous rejection nie blokuje następnych operacji |
| Unhandled rejection safety | OK | Wszystkie `void promise.catch()` w fire-and-forget paths |
| Listener error isolation | OK | try/catch wokół listener callbacks |

### 4.3 Architektura

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Separation of concerns | OK | Transport → Client → Accessory → Platform |
| Interface segregation | OK | `MiioTransport` interface w `types.ts` |
| SRP | OK | Każdy moduł ma jedną odpowiedzialność |
| Testowalność | OK | Dependency injection przez constructor |
| No god objects | OK | Największa klasa (~250 linii) to transport, co jest uzasadnione |

### 4.4 Zarządzanie zasobami

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Timer cleanup | OK | Centralne `clearTimers()` |
| Socket cleanup | OK | `close()` z idempotent guard |
| Event listener cleanup | OK | `onStateUpdate`/`onConnectionEvent` zwracają unsubscribe fn |
| Memory leaks | OK | `characteristicCache` to bounded Map (max ~30 entries) |
| `.unref()` na timerach | OK | Nie blokuje process exit |

### 4.5 Logowanie

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Log levels | OK | debug/info/warn/error odpowiednio użyte |
| Sensitive data | OK | Token NIGDY nie jest logowany |
| IP masking | OK | Opcja `maskDeviceAddressInLogs` z pattern `x.x.*.*` |
| Verbose mode | OK | Szczegóły diagnostyczne na `debug` level |
| Connection lifecycle | OK | Czytelne logi connected/disconnected/reconnected |

### 4.6 Polling i wydajność

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Dual polling | OK | Operation (10s) + Sensor (30s) — optymalny podział |
| Keep-alive | OK | 60s background heartbeat |
| Dedup updates | OK | `characteristicCache` zapobiega duplicate pushes |
| Batch MIOT reads | OK | Jeden `get_properties` call zamiast 13 osobnych |
| Protocol detection | OK | Automatyczne MIOT/legacy probing z cache |

### Ocena jakości kodu: **9.5/10**

---

## 5. Security & Supply Chain

### 5.1 Wrażliwe dane

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Token w logach | OK | Nigdy nie logowany; walidacja w `platform.ts` |
| Token w configu | OK | Schema wymaga regex `^[0-9a-fA-F]{32}$` |
| Token w pamięci | OK | Przechowywany jako `Buffer` (hex-decoded) |
| IP masking | OK | Opcjonalne — `maskDeviceAddressInLogs` |
| SerialNumber | UWAGA | Zawiera IP w `miap-10-0-0-1` — zgodne z praktyką Homebridge, ale warto odnotować |

### 5.2 Komunikacja z urządzeniem

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Protokół | UDP | MIIO over UDP 54321 — brak TLS, ale to standard Xiaomi |
| Szyfrowanie | AES-128-CBC | Poprawne: key = MD5(token), iv = MD5(key + token) |
| Handshake | OK | Standard MIIO z device stamp |
| Replay protection | Częściowe | Message ID + timestamp — standard protokołu |
| README hardening | OK | Sekcja "Network hardening" z rekomendacjami VLAN/firewall |

### 5.3 Dependencies

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Runtime deps | **0** | Absolutnie żadnych — złoty standard |
| Dev deps | 5 | biome, @types/node, vitest, coverage-v8, typescript |
| `npm audit` | OK | 0 vulnerabilities |
| `package-lock.json` | OK | lockfileVersion 3, obecny w repo |
| `engine-strict=true` | OK | w `.npmrc` |

### 5.4 Supply chain automation

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Dependabot (npm) | OK | Weekly, 10 PR limit |
| Dependabot (GitHub Actions) | OK | Weekly, 5 PR limit |
| npm audit in CI | OK | `--audit-level=high` w ci.yml + release.yml |
| SBOM generation | OK | CycloneDX w `supply-chain.yml` |
| OSV Scanner | OK | `google/osv-scanner-action@v2.3.3` |
| npm provenance | OK | `NPM_CONFIG_PROVENANCE: "true"` w release |
| Pinned actions | OK | `@v4` tags (consider SHA pinning for hardening) |

### 5.5 CI permissions

| Workflow | Permissions | Status |
|----------|-------------|--------|
| ci.yml | `contents: read` | OK — minimal |
| supply-chain.yml | `contents: read` | OK — minimal |
| release.yml | `contents: write, issues: write, pull-requests: write, id-token: write` | OK — required for semantic-release + provenance |

### Ocena security: **9/10**

Jedyne sugestie: SHA pinning actions, rozważyć Scorecard action.

---

## 6. Testy, CI/CD i automatyzacja

### 6.1 Testy

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| Framework | vitest | Nowoczesny, szybki |
| Pliki testowe | 9 | 84 testy łącznie |
| Pokrycie | **100%** | Statements, branches, functions, lines |
| Threshold enforcement | OK | `vitest.config.ts` — build fails < 100% |
| Test categories | Varied | Unit, integration-style, reliability scenarios, branch coverage |
| Network scenarios | OK | 7 scenariuszy restart/reconnect w `network-scenarios.test.ts` |
| Fake timers | OK | `vi.useFakeTimers()` — testy nie czekają na real delays |
| Mock isolation | OK | `vi.restoreAllMocks()` w afterEach |

### 6.2 CI Pipeline

| Job | Zakres | Status |
|-----|--------|--------|
| test (matrix) | lint + typecheck + test | Node 20/22/24 × HB 1.11.2 + Node 22/24 × HB beta |
| audit | `npm audit --audit-level=high` | OK |
| sbom | CycloneDX SBOM generation | OK |
| osv-scanner | Vulnerability scanning | OK |
| concurrency | `cancel-in-progress: true` | OK — oszczędza CI minutes |
| coverage artifact | Upload na Node full lanes | OK |

### 6.3 Release workflow

| Aspekt | Status | Komentarz |
|--------|--------|-----------|
| semantic-release | OK | `.releaserc.json` z 6 pluginami |
| Conventional commits | OK | Opisane w CONTRIBUTING.md |
| Auto changelog | OK | `@semantic-release/changelog` |
| Auto npm publish | OK | `@semantic-release/npm` z provenance |
| Git tag/commit | OK | `@semantic-release/git` z `[skip ci]` |
| GitHub release | OK | `@semantic-release/github` |
| Pre-release checks | OK | audit + check (lint+typecheck+test) before release |

### Ocena CI/CD: **10/10**

---

## 7. Lista krytycznych problemów (blokery publikacji npm)

**Brak krytycznych blokerów.** Projekt jest gotowy do publikacji na npm.

---

## 8. Lista usprawnień (priorytetyzowana)

### HIGH priority

| # | Usprawnienie | Uzasadnienie | Sugestia |
|---|-------------|--------------|----------|
| H1 | Rozważyć dodanie `"sourceMap": true` do tsconfig | Ułatwia debugowanie stack traces w produkcji | `tsconfig.json`: dodać `"sourceMap": true` |
| H2 | Dodać `PM2_5Density` bounding | `Math.max(0, state.aqi)` nie ogranicza górnej wartości; HomeKit akceptuje 0-1000 | `air-purifier.ts:411`: `Math.min(1000, Math.max(0, state.aqi))` |
| H3 | Config schema — brak `"description"` przy polach `name`, `address`, `model` | Homebridge UI wyświetla puste opisy | Dodać `"description"` do tych pól w `config.schema.json` |

### MEDIUM priority

| # | Usprawnienie | Uzasadnienie | Sugestia |
|---|-------------|--------------|----------|
| M1 | SHA pinning GitHub Actions | Ochrona przed supply-chain (tag hijacking) | Zamienić `@v4` na SHA w workflow files |
| M2 | Dodać OpenSSF Scorecard action | Widoczność bezpieczeństwa w npm/GitHub | Dodać `ossf/scorecard-action` do workflows |
| M3 | Bug report template — brak `plugin_version` | Przydatne do triage | Dodać pole `plugin_version` do `bug_report.yml` |
| M4 | `Reflect.get()` usage zamiast type narrowing | Choć poprawne, kilka `Reflect.get()` calls mogłoby być czytelniejszych | Niskoriorytetowe; obecne podejście działa z HB 1.x compatibility |
| M5 | config.schema.json — `"required"` property placement | `"required"` powinno być w JSON Schema `"required"` array na obiekcie, nie na property | Standard Homebridge UI akceptuje oba formaty, więc to kosmetyka |

### LOW priority

| # | Usprawnienie | Uzasadnienie | Sugestia |
|---|-------------|--------------|----------|
| L1 | Dodać `PM2_5Density` bounding log | Jeśli AQI > 1000, warto logować na `debug` | Optionalne |
| L2 | CHANGELOG — dodać `[1.0.0]` release header | Obecny jest tylko `[Unreleased]` | Zostanie naprawione przez semantic-release |
| L3 | Rozważyć platform plugin w v2.0 | Automatyczne discovery, łatwiejsze zarządzanie wieloma urządzeniami | Większy refactor, nie na teraz |
| L4 | `export =` syntax | To legacy CJS export; rozważyć `export default` w przyszłości | Wymaga zmian w module config |

---

## 9. Sugestie zmian w plikach

### 9.1 config.schema.json — dodanie opisów

```json
"name": {
  "title": "Name",
  "type": "string",
  "required": true,
  "default": "Air Purifier",
  "placeholder": "Air Purifier",
  "description": "Display name for this accessory in HomeKit."
},
"address": {
  "title": "IP Address",
  "type": "string",
  "required": true,
  "format": "ipv4",
  "description": "LAN IP address of the air purifier."
},
"model": {
  "title": "Model",
  "type": "string",
  "required": true,
  "description": "Xiaomi model identifier. Check README for supported models.",
  "enum": [...]
}
```

### 9.2 GitHub Actions — SHA pinning (example)

```yaml
# ci.yml - obecne
- uses: actions/checkout@v4

# ci.yml - zalecane (SHA pinning)
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.7
```

### 9.3 Bug report template — dodanie pola version

```yaml
- type: input
  id: plugin_version
  attributes: {label: Plugin version}
  validations: {required: true}
```

---

## 10. Ocena zgodności ze standardami Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja | 10/10 | Poprawne `registerAccessory` z odpowiednimi aliasami |
| Lifecycle | 10/10 | Init, shutdown, timer cleanup — wzorcowe |
| Error handling | 10/10 | Graceful degradation, retry, isolated errors |
| Config validation | 10/10 | Walidacja token, model, timeoutów, threshold |
| Config schema | 9/10 | Brak opisów na 3 polach; layout jest dobry |
| HomeKit mapping | 10/10 | Kompletne, z fallbackami HB 1.x/2.x |
| Reconnect stability | 10/10 | Exponential backoff, connection events, tested |
| Compatibility | 10/10 | Dynamiczna detekcja services, peerDeps poprawne |
| **Łączna ocena** | **9.9/10** | |

---

## 11. Checklista „gotowe do npm"

| Element | Status | Komentarz |
|---------|--------|-----------|
| `package.json` name | ✅ | `homebridge-xiaomi-air-purifier-modern` |
| `package.json` version | ✅ | `1.0.0` — semantic-release zarządza dalej |
| `package.json` description | ✅ | Czytelny opis |
| `package.json` main | ✅ | `dist/index.js` |
| `package.json` types | ✅ | `dist/index.d.ts` |
| `package.json` files | ✅ | `dist`, `config.schema.json`, docs |
| `package.json` keywords | ✅ | 15 trafnych keywords |
| `package.json` engines | ✅ | Node 20/22/24 + HB 1.x/2.x |
| `package.json` peerDependencies | ✅ | homebridge ^1.11.1 \|\| ^2.0.0 |
| `package.json` homepage | ✅ | GitHub URL |
| `package.json` repository | ✅ | Git URL |
| `package.json` bugs | ✅ | Issues URL |
| `package.json` license | ✅ | MIT |
| `package.json` author | ✅ | TaKeN z URL |
| `package.json` displayName | ✅ | Dla Homebridge UI |
| `package.json` prepublishOnly | ✅ | lint + typecheck + test + build |
| `package.json` scripts.prepare | ✅ | build |
| config.schema.json | ✅ | Z layoutem i walidacjami |
| LICENSE | ✅ | MIT |
| README.md | ✅ | Kompletne: install, config, troubleshooting, development |
| CHANGELOG.md | ✅ | Keep a Changelog format |
| CONTRIBUTING.md | ✅ | Commit standard, local checks, PR process |
| CODE_OF_CONDUCT.md | ✅ | Contributor Covenant 2.1 |
| SECURITY.md | ✅ | Z SLA triage/fix |
| .editorconfig | ✅ | Spójne formatowanie |
| .gitignore | ✅ | node_modules, dist, coverage, *.tgz |
| .npmrc | ✅ | engine-strict=true |
| package-lock.json | ✅ | lockfileVersion 3 |
| tsconfig.json | ✅ | strict + advanced checks |
| Linter (Biome) | ✅ | recommended + noExplicitAny |
| Formatter (Biome) | ✅ | space indent |
| Tests (Vitest) | ✅ | 84 tests, 100% coverage |
| CI (GitHub Actions) | ✅ | Multi-node, multi-HB, audit |
| Release workflow | ✅ | semantic-release z provenance |
| Dependabot (npm) | ✅ | Weekly |
| Dependabot (Actions) | ✅ | Weekly |
| Supply chain (SBOM) | ✅ | CycloneDX |
| Supply chain (OSV) | ✅ | osv-scanner |
| Issue templates | ✅ | Bug + Feature + config |
| PR template | ✅ | Summary + checklist |
| npm audit clean | ✅ | 0 vulnerabilities |
| npm pack verified | ✅ | 25 files, 21.4 kB |
| Build verified | ✅ | tsc compiles clean |
| dist output | ✅ | JS + .d.ts declarations |
| Zero runtime deps | ✅ | |

### Brakujące (opcjonalne, nie blokujące):

| Element | Status | Priorytet |
|---------|--------|-----------|
| Source maps | ❌ | Low |
| OpenSSF Scorecard | ❌ | Medium |
| SHA-pinned Actions | ❌ | Medium |
| `.npmignore` | N/A | `files` field jest lepszym podejściem |
| `CODEOWNERS` | ❌ | Low (single maintainer) |
| Stale bot / auto-labels | ❌ | Low |

---

## 12. Podsumowanie końcowe

**Projekt jest gotowy do publikacji na npm.** Jakość kodu, architektury, testów i infrastruktury CI/CD jest na poziomie znacznie powyżej przeciętnej w ekosystemie Homebridge.

Kluczowe zalecenia na przyszłość:
1. SHA pinning GitHub Actions (security hardening)
2. Rozważyć migrację na platform plugin w v2.0 (lepsze multi-device UX)
3. Dodać opisy do 3 pól w config.schema.json (UX Homebridge UI)

**Ocena ogólna: 9.5/10** — profesjonalny, produkcyjny projekt OSS.
