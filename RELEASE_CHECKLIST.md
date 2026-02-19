# Release Checklist

- [ ] Pull latest `main`
- [ ] Run lint/typecheck/test/build locally
- [ ] Verify coverage thresholds (lines >= 80%, branches >= 70%)
- [ ] Update CHANGELOG.md
- [ ] Run `npm run release`
- [ ] Push commit + tag
- [ ] Create GitHub Release
- [ ] Publish package (`npm publish --access public`)
- [ ] Validate install via `npm pack` and Homebridge startup
