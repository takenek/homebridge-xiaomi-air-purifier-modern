# Release checklist

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (coverage thresholds are 100% lines/functions/branches/statements)
- [ ] `npm run build`
- [ ] `npm pack --dry-run` and verify package contents
- [ ] Update `CHANGELOG.md`
- [ ] Publish via one of: `npm run release:patch|release:minor|release:major`
