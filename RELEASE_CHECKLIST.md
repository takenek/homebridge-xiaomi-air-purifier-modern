# Release checklist

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (coverage thresholds are 100% lines/functions/branches/statements)
- [ ] `npm run build`
- [ ] `npm pack --dry-run` and verify package contents
- [ ] Review `CHANGELOG.md`
- [ ] Publish flow: semantic-release workflow on `main` (preferred) or emergency manual tag release
