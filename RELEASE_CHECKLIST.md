# Release Checklist

- [ ] Pull latest `main`
- [ ] Run lint/typecheck/test/build locally
- [ ] Verify all coverage thresholds pass (100% lines/branches/functions/statements; miio-transport.ts is excluded)
- [ ] Update CHANGELOG.md
- [ ] Run `npm run release:patch` (or `release:minor` / `release:major`)
- [ ] Push commit + tag
- [ ] Create GitHub Release
- [ ] Publish package (`npm publish --access public`)
- [ ] Validate install via `npm pack` and Homebridge startup
