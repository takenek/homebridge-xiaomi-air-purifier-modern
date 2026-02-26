# Release checklist

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (coverage thresholds are 95 lines / 90 branches / 95 functions / 95 statements)
- [ ] `npm run build`
- [ ] `npm pack --dry-run` and verify package contents
- [ ] Update `CHANGELOG.md` (`## [Unreleased]`)
- [ ] Merge to `main` with Conventional Commit messages (semantic-release publishes automatically)
