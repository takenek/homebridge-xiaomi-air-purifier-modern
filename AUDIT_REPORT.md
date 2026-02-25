# Code Review & Quality Audit Report
## homebridge-xiaomi-air-purifier-modern v1.0.0

**Auditor:** Claude Code (Sonnet 4.6)
**Date:** 2026-02-25
**Scope:** Full codebase — source code, tests, CI/CD, configuration, documentation, security

---

## 1. Executive Summary

### Największe plusy

1. **Architektura TypeScript**: Strict mode, `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — jeden z najsurowszych możliwych zestawów reguł tsc. Kod nie zawiera żadnych `any`.
2. **Wyjątkowa odporność sieciowa**: 19 kodów błędów sieciowych w `RETRYABLE_ERROR_CODES`, exponential backoff z jitterem, kolejkowanie operacji (operationQueue), rozróżnienie błędów retryable vs fatal.
3. **Kompleksowe testy**: 8 plików testowych, 59 przypadków, 100% pokrycia dla wszystkich plików z wyjątkiem `miio-transport.ts` (który jest wykluczony świadomie).
4. **Bezpieczeństwo supply chain**: `package-lock.json` (lockfile v3), Dependabot na npm + GitHub Actions, brak zbędnych zależności produkcyjnych — zero dependencies runtime.
5. **Poprawna obsługa lifecycle Homebridge**: `api.on("shutdown", ...)`, czyszczenie timerów, `void` + `.catch(...)` przy fire-and-forget, obsługa reconnect bez restartu.

### Największe ryzyka (przed audytem)

1. **Mismatch schema/kod**: 5 pól UI w `config.schema.json` (`enableAirQuality`, `enableTemperature`, `enableHumidity`, `enableFanSpeedControl`, `enableChildLockControl`) nie miało żadnej implementacji — użytkownik widział opcje, które nic nie robiły. **(NAPRAWIONE)**
2. **`JSON.parse` bez try/catch** w `sendCommand()` — uszkodzony pakiet UDP mógł rzucić `SyntaxError` z nieczytelnym komunikatem. **(NAPRAWIONE)**
3. **`homebridge` brak w `devDependencies`** — działało via npm 7+ auto-install peerDeps, ale nie było jawnie zadeklarowane i mogło zawieść w niestandardowych środowiskach. **(NAPRAWIONE)**
4. **Duplikat opisu testu** — dwa identyczne `it("uses numeric fallbacks for FilterChangeIndication enum values", ...)` utrudniały diagnozowanie błędów testów. **(NAPRAWIONE)**
5. **Brak walidacji modelu** — zły string modelu był przyjmowany bez ostrzeżenia; teraz `log.warn()` przy nieznanym modelu. **(NAPRAWIONE)**

---

## 2. Krytyczne problemy (blokery publikacji na npm)

### C1. Schema/kod mismatch — pola UI bez implementacji ✅ NAPRAWIONE

**Pliki:** `config.schema.json`, `src/platform.ts`, `src/accessories/air-purifier.ts`

Pola `enableAirQuality`, `enableTemperature`, `enableHumidity`, `enableFanSpeedControl`, `enableChildLockControl` były widoczne w UI Homebridge, ale kod je ignorował — wszystkie sensory i przełączniki były zawsze eksponowane. Użytkownik wierzył, że ma kontrolę, a opcje nic nie robiły.

**Rozwiązanie zastosowane:** Usunięto pięć pól z `config.schema.json` oraz z sekcji `layout`. Istniejące konfiguracje użytkowników nie są łamane (dodatkowe pola w config.json są ignorowane przez Homebridge). Ewentualna implementacja feature'ów w przyszłości to osobne zadanie (patrz sekcja 3, punkt H3).

### C2. Brak `homebridge` w `devDependencies` ✅ NAPRAWIONE

**Plik:** `package.json`

`homebridge` był tylko w `peerDependencies`. W npm 7+ to działa (peer deps są instalowane automatycznie), ale:
- nie jest jawnie widoczne dla developerów/CI
- przy konflikcie wersji npm może pominąć instalację
- nie ma gwarancji stabilnej wersji w lock file bez deklaracji w devDeps

**Rozwiązanie zastosowane:** Dodano `"homebridge": "^1.11.1"` do `devDependencies`.

---

## 3. Ważne usprawnienia

### H1 — WYSOKI: `JSON.parse` bez try/catch w `sendCommand` ✅ NAPRAWIONE

**Plik:** `src/core/miio-transport.ts:643`

```typescript
// PRZED:
const parsed = JSON.parse(decrypted.toString("utf8")) as MiioResponsePayload;

// PO:
let parsed: MiioResponsePayload;
try {
  parsed = JSON.parse(decrypted.toString("utf8")) as MiioResponsePayload;
} catch {
  throw new Error("Invalid JSON in MIIO response payload");
}
```

Uszkodzony lub skorumpowany pakiet UDP mógł powodować `SyntaxError` bez czytelnego kontekstu. Teraz błąd ma opisowy komunikat i propaguje się czyszciej przez retry logic.

### H2 — WYSOKI: Walidacja modelu w runtime ✅ NAPRAWIONE

**Plik:** `src/platform.ts`

Dodano tablicę `VALID_MODELS` i ostrzeżenie `log.warn()` gdy model nie należy do listy obsługiwanych. Plugin nadal startuje (nie rzuca błędu), bo protokół auto-detect może działać z nierozpoznanym modelem.

### H3 — WYSOKI: Martwy kod — mappers i metody DeviceClient nigdy nieużywane

**Pliki:** `src/core/mappers.ts`, `src/core/device-client.ts`, `src/accessories/air-purifier.ts`

Następujące funkcje/metody są w kodzie, ale nie ma ścieżki wywołania:

| Funkcja | Plik | Problem |
|---------|------|---------|
| `fanLevelToRotationSpeed()` | `mappers.ts` | Nigdzie nieużywana |
| `rotationSpeedToFanLevel()` | `mappers.ts` | Nigdzie nieużywana |
| `DeviceClient.setFanLevel()` | `device-client.ts` | Niewywoływana z `AirPurifierAccessory` |
| `DeviceClient.setBuzzerVolume()` | `device-client.ts` | Niewywoływana z `AirPurifierAccessory` |
| `DeviceState.motor1_speed` | `types.ts` | Czytane z urządzenia, ale nie eksponowane w HomeKit |
| `DeviceState.use_time` | `types.ts` | Jw. |
| `DeviceState.purify_volume` | `types.ts` | Jw. |

**Rekomendacja:** Albo zaimplementować fan speed control service (`RotationSpeed` characteristic na `AirPurifierService` lub dedykowany `Switch` + slider), albo usunąć martwy kod aby nie mylić przyszłych maintainerów. Wskazówka z `config.schema.json` sugeruje, że fan speed był planowany — jeśli nie wejdzie w v1.0, powinien być usunięty lub oznaczony jako TODO w komentarzu.

### H4 — WYSOKI: Brak `npm audit` w CI ✅ NAPRAWIONE

**Plik:** `.github/workflows/ci.yml`

Dodano job `audit` uruchamiający `npm audit --audit-level=high` przed innymi jobami.

### H5 — WYSOKI: RELEASE_CHECKLIST.md był niepoprawny i w npm package ✅ NAPRAWIONE

Checklista mówiła "lines >= 80%, branches >= 70%", a faktyczne progi w `vitest.config.ts` to 100%. Plik był też publikowany do npm (`files` field). Naprawiono obie kwestie.

### M1 — ŚREDNI: Duplikat opisu testu ✅ NAPRAWIONE

**Plik:** `test/accessory-platform-index.test.ts`

Dwa identyczne `it("uses numeric fallbacks...")` uniemożliwiały jednoznaczną identyfikację testu w raportach vitest. Drugi zmieniono na `"uses numeric fallbacks for FilterChangeIndication when ContactSensor alert is enabled"`.

### M2 — ŚREDNI: `tsconfig.json` wstrzykuje globals vitest do build context

**Plik:** `tsconfig.json`

```json
"types": ["node", "vitest/globals"]
```

`vitest/globals` sprawia, że `describe`, `it`, `expect` są dostępne globalnie w kontekście KOMPILACJI produkcyjnej — nie runtime'u, ale to niepotrzebne zanieczyszczenie. Właściwym rozwiązaniem jest osobny `tsconfig.test.json`:

```json
// tsconfig.test.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"]
}
```

I zmodyfikować `tsconfig.json`:
```json
"types": ["node"]
```

`vitest.config.ts` należy wtedy rozszerzyć o `typecheck: { tsconfig: './tsconfig.test.json' }`.

### M3 — ŚREDNI: Brak `SECURITY.md` ✅ NAPRAWIONE

Dodano plik z informacjami o wspieranych wersjach, procesie zgłaszania podatności i kluczowych aspektach bezpieczeństwa (token, local LAN only, AES-128-CBC).

### M4 — ŚREDNI: Brak `CODE_OF_CONDUCT.md` ✅ NAPRAWIONE

Dodano plik na bazie Contributor Covenant v2.1.

### M5 — ŚREDNI: Potencjalny overflow stempel sesji MIIO

**Plik:** `src/core/miio-transport.ts:618`

```typescript
const stamp = session.deviceStamp + elapsed;
header.writeUInt32BE(stamp, 12);  // może rzucić RangeError gdy stamp > 0xFFFFFFFF
```

Jeśli urządzenie ma bardzo duże `deviceStamp` + długi uptime, suma może przekroczyć 32-bit unsigned. `writeUInt32BE` rzuca `RangeError` przy overflow. Rozwiązanie: `stamp >>> 0` (bitwise unsigned truncation) lub `stamp & 0xFFFFFFFF`.

### M6 — ŚREDNI: `isTransportError` jest za szeroka

**Plik:** `src/core/miio-transport.ts:565–572`

```typescript
private isTransportError(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof MiioCommandError) return false;
  const code = Reflect.get(error, "code");
  return typeof code === "string";  // każdy Error z code: string = ponowny handshake
}
```

Każdy błąd sieciowy (np. `ECONNRESET`, `ETIMEDOUT`) triggeruje ponowny handshake. To celowe, ale warto sprawdzić, czy zbyt wiele błędów nie powoduje excessive handshakes przy niestabilnym połączeniu.

### L1 — NISKI: Brak issue/PR templates

Brak `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md` i `.github/pull_request_template.md`. Przy rosnącym projekcie ułatwiają community engagement.

### L2 — NISKI: `VALID_MODELS` w `types.ts` a nie `platform.ts`

Z architektonicznego punktu widzenia lista obsługiwanych modeli lepiej pasuje do `src/core/types.ts` (obok `AirPurifierModel` type union) niż do `platform.ts`. Obie lokalizacje działają, ale unikamy duplikacji, gdy będziemy chcieli użyć listy w innym miejscu.

### L3 — NISKI: `_props` parametr w `MiioTransport.getProperties()`

**Plik:** `src/core/types.ts`, `src/core/miio-transport.ts`

```typescript
public async getProperties(
  _props: readonly ReadProperty[],  // parametr ignorowany
): Promise<DeviceState>
```

Transport zawsze czyta wszystkie właściwości bez względu na żądanie. Interfejs `MiioTransport` sugeruje możliwość częściowego odczytu, ale faktyczna implementacja tego nie robi. Albo usunąć parametr z interfejsu i implementacji (breaking zmiana), albo dodać komentarz wyjaśniający intencję.

### L4 — NISKI: `Reflect.get` zamiast opcjonalnego dostępu do charakterystyk

**Plik:** `src/accessories/air-purifier.ts`

```typescript
const filterChangeIndication = Reflect.get(
  this.api.hap.Characteristic.FilterChangeIndication as object,
  "CHANGE_FILTER",
);
```

Użycie `Reflect.get` jako workaround na brak typowania Homebridge 1.x vs 2.x jest poprawne funkcjonalnie, ale utrudnia czytelność. Z `homebridge` w devDependencies można teraz użyć normalnego dostępu z opcjonalnym chainingiem lub explicit type assertion. Ewentualnie helper:

```typescript
const getCharacteristicValue = (obj: unknown, key: string): number | undefined => {
  const v = Reflect.get(obj as object, key);
  return typeof v === "number" ? v : undefined;
};
```

---

## 4. Sugestie zmian w plikach

### 4.1 `package.json` — wersja ostateczna

```json
{
  "name": "homebridge-xiaomi-air-purifier-modern",
  "version": "1.0.0",
  "description": "Modern Homebridge plugin for Xiaomi Mi Air Purifier (2H/3/3H/4/Pro)",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": [
    "homebridge-plugin",
    "homebridge",
    "xiaomi",
    "mi-home",
    "miio",
    "air-purifier",
    "homekit"
  ],
  "engines": {
    "node": "^24.13.0 || ^22.22.0 || ^20.20.0",
    "homebridge": "^1.11.1 || ^2.0.0-beta.0"
  },
  "homepage": "https://github.com/takenek/xiaomi-mi-air-purifier-ng#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/takenek/xiaomi-mi-air-purifier-ng.git"
  },
  "bugs": {
    "url": "https://github.com/takenek/xiaomi-mi-air-purifier-ng/issues"
  },
  "license": "MIT",
  "files": [
    "dist",
    "config.schema.json",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "prepack": "npm run build",
    "release": "npm version patch && git push --follow-tags"
  },
  "peerDependencies": {
    "homebridge": "^1.11.1 || ^2.0.0-beta.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.3",
    "@types/node": "^25.3.0",
    "@vitest/coverage-v8": "^4.0.0",
    "homebridge": "^1.11.1",
    "typescript": "^5.8.2",
    "vitest": "^4.0.0"
  },
  "author": "TaKeN"
}
```

**Dodatkowe sugestie:**
- Dodać `"mi-home"` i `"miio"` do `keywords` — istotne dla discovery w Homebridge plugin store
- Dodać `"homepage"` z `#readme` suffix (konwencja npm)
- Opcjonalnie: `"funding": { "type": "github", "url": "..." }`

### 4.2 Proponowany `tsconfig.json` (produkcja only)

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
  "exclude": ["dist", "node_modules"]
}
```

```json
// tsconfig.test.json (nowy plik)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src", "test"]
}
```

### 4.3 Proponowany release workflow (semantic-release)

Obecny `"release": "npm version patch && git push --follow-tags"` jest ręczny i wymaga zachowania dyscypliny. Rekomendowane usprawnienie: `semantic-release` z `@semantic-release/changelog` i `@semantic-release/npm`.

```bash
npm install --save-dev semantic-release @semantic-release/changelog @semantic-release/git
```

`.releaserc.json`:
```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { "changelogFile": "CHANGELOG.md" }],
    "@semantic-release/npm",
    ["@semantic-release/git", {
      "assets": ["CHANGELOG.md", "package.json"],
      "message": "chore(release): ${nextRelease.version} [skip ci]"
    }],
    "@semantic-release/github"
  ]
}
```

CI job (tylko na `main` po merge):
```yaml
release:
  name: ci / release
  runs-on: ubuntu-latest
  needs: [audit, lint, typecheck, test, build]
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0
        persist-credentials: false
    - uses: actions/setup-node@v6
      with:
        node-version: 20
        registry-url: 'https://registry.npmjs.org'
        cache: npm
    - run: npm ci
    - run: npx semantic-release
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 4.4 Bezpieczeństwo stempla MIIO (opcjonalne)

```typescript
// src/core/miio-transport.ts ~linia 618
const stamp = (session.deviceStamp + elapsed) >>> 0;  // bezpieczny uint32 truncation
header.writeUInt32BE(stamp, 12);
```

---

## 5. Ocena zgodności z Homebridge 1.x i 2.x

| Kryterium | Ocena | Komentarz |
|-----------|-------|-----------|
| Rejestracja wtyczki (`registerAccessory`) | ✅ | Poprawna sygnatura, PLUGIN_NAME + ACCESSORY_NAME |
| `AccessoryPlugin` interface (nie Platform) | ✅ | `getServices()` zwraca `Service[]` |
| Lifecycle shutdown (`api.on("shutdown")`) | ✅ | Poprawna subskrypcja, timery czyszczone |
| `peerDependencies` HB 1.11.1 + 2.0.0-beta | ✅ | Obie wersje zadeklarowane |
| `engines.homebridge` field | ✅ | `"^1.11.1 || ^2.0.0-beta.0"` |
| `config.schema.json` `pluginType: "accessory"` | ✅ | Poprawny typ |
| ConfiguredName (HB 2.x only) | ✅ | Sprawdzany przez `Reflect.get` z fallback |
| Charakterystyki `Name` ustawiane | ✅ | `applyServiceNames()` |
| Polling zamiast event-driven | ⚠️ | Akceptowalne dla LAN UDP, ale 10s op / 30s sensor to agresywny polling — rozważyć 30/60 dla domyślnych |
| Obsługa brakujących właściwości MIOT | ✅ | Per-property fallback i legacy fallback |
| Brak `StorageService`, brak fs write | ✅ | Plugin nie persystuje danych poza Homebridge config |

**Ogólna ocena zgodności: 9/10** — Jeden punkt odjęty za agresywne domyślne interwały pollingu, które mogą obciążać urządzenie i sieć.

---

## 6. Checklista „gotowe do npm"

### Infrastruktura projektu

| Element | Status |
|---------|--------|
| `LICENSE` (MIT) | ✅ |
| `README.md` z konfiguracją i troubleshootingiem | ✅ |
| `CHANGELOG.md` (Keep a Changelog format) | ✅ (tylko Unreleased) |
| `CONTRIBUTING.md` | ✅ (minimalny) |
| `CODE_OF_CONDUCT.md` | ✅ dodany |
| `SECURITY.md` | ✅ dodany |
| Issue templates (bug/feature) | ❌ brak |
| PR template | ❌ brak |

### package.json

| Element | Status |
|---------|--------|
| Poprawne `name` (unikalne, `homebridge-` prefix) | ✅ |
| `version` semver | ✅ |
| `description` | ✅ |
| `main` → `dist/index.js` | ✅ |
| `types` → `dist/index.d.ts` | ✅ |
| `keywords` z `homebridge-plugin` | ✅ |
| `homepage` | ✅ |
| `repository` | ✅ |
| `bugs` | ✅ |
| `license` | ✅ |
| `files` (tylko dist + docs) | ✅ naprawione |
| `engines.node` | ✅ |
| `engines.homebridge` | ✅ |
| `peerDependencies` | ✅ |
| `homebridge` w `devDependencies` | ✅ naprawione |
| Zero runtime dependencies | ✅ |
| `prepack` buduje przed pack | ✅ |
| Automatyczny release (semantic-release) | ❌ (manual, rekomendowane) |

### Tooling

| Element | Status |
|---------|--------|
| `tsconfig.json` strict mode | ✅ |
| ESLint / Biome | ✅ (Biome) |
| Prettier / Biome formatter | ✅ (Biome) |
| `.editorconfig` | ❌ brak |
| `vitest` + coverage | ✅ |
| 100% coverage (bez miio-transport.ts) | ✅ |
| `package-lock.json` | ✅ |
| Dependabot npm + GH Actions | ✅ |

### CI/CD

| Element | Status |
|---------|--------|
| Build job | ✅ |
| Typecheck job | ✅ |
| Lint job | ✅ |
| Test + coverage job | ✅ |
| `npm audit` job | ✅ naprawione |
| Matrix Node.js 20/22/24 | ✅ |
| Automated publish | ❌ (manual) |
| Release notes automation | ❌ (manual) |

### Kod

| Element | Status |
|---------|--------|
| `config.schema.json` zgodny z kodem | ✅ naprawione |
| Walidacja tokenu (32-hex) | ✅ |
| Walidacja adresu IP (schema format: ipv4) | ✅ |
| Walidacja modelu (runtime warn) | ✅ naprawione |
| `JSON.parse` z try/catch | ✅ naprawione |
| Obsługa błędów sieciowych (retry/backoff) | ✅ |
| Czyszczenie timerów przy shutdown | ✅ |
| Brak wrażliwych danych w logach | ✅ (token nie jest logowany) |
| Martwy kod (fan speed, buzzer) | ⚠️ zidentyfikowany, wymaga decyzji |

---

## 7. Rekomendowany plan działań przed `npm publish`

### Must-do (przed 1.0.0)
1. ✅ (naprawione) Usunąć nieimplementowane pola z `config.schema.json`
2. ✅ (naprawione) `homebridge` do `devDependencies`
3. ✅ (naprawione) `JSON.parse` w try/catch
4. Podjąć decyzję o martwym kodzie (fan speed, buzzer): zaimplementować lub usunąć
5. Zamienić `CHANGELOG.md [Unreleased]` → `[1.0.0]` przed releasem
6. Nadać wersję `1.0.0` i stworzyć GitHub Release

### Should-do (przed lub po 1.0.0)
7. Dodać keywords `"miio"`, `"mi-home"` w package.json
8. Rozdzielić `tsconfig.json` i `tsconfig.test.json`
9. Skonfigurować `semantic-release`
10. Dodać issue/PR templates
11. Naprawić potential uint32 overflow w `sendCommand`
12. Rozważyć domyślne interwały pollingu (30s/60s zamiast 10s/30s)

---

*Raport wygenerowany przez Claude Code — pełna analiza obejmuje ~2 000 linii kodu źródłowego, 8 plików testowych i kompletną infrastrukturę projektu.*
