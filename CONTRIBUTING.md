# Contributing

## Commit standard
Use Conventional Commits, e.g.:
- `feat: add retry jitter`
- `fix: prevent timer leak on shutdown`

Commits are validated in CI using commitlint.

## Local checks
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Release process
- Releases are automated with **semantic-release** on pushes to `main`.
- Do not manually bump versions in PRs unless explicitly requested.
- Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md`; semantic-release will prepare release notes and tags.

## Support & deprecations
- Supported platforms follow `package.json` (`engines` + `peerDependencies`).
- Deprecated config keys/features must be announced in `CHANGELOG.md` and kept for at least one minor release before removal in a major release.

## PR process
1. Open PR with clear summary and test evidence.
2. Ensure CI is green for lint, typecheck, test (coverage), build.
3. Update CHANGELOG for user-visible changes.
