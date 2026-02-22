# Contributing

## Commit standard
Use Conventional Commits, e.g.:
- `feat: add retry jitter`
- `fix: prevent timer leak on shutdown`

## Local checks
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## PR process
1. Open PR with clear summary and test evidence.
2. Ensure CI is green for lint, typecheck, test (coverage), build.
3. Update CHANGELOG for user-visible changes.
