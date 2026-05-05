# Contributing

## Commit standard
Use Conventional Commits, e.g.:
- `feat: add retry jitter`
- `fix: prevent timer leak on shutdown`

## Support & deprecations
- Supported runtimes follow `package.json` engines.
- User-visible deprecations must be documented in `CHANGELOG.md` before removal in the next major release.

## Local checks
```bash
env -u npm_config_http_proxy -u npm_config_https_proxy npm run lint
env -u npm_config_http_proxy -u npm_config_https_proxy npm run typecheck
env -u npm_config_http_proxy -u npm_config_https_proxy npm test
env -u npm_config_http_proxy -u npm_config_https_proxy npm run build
```

## PR process
1. Open PR with clear summary and test evidence.
2. Ensure CI is green for lint, typecheck, test (coverage), build.
3. Update CHANGELOG for user-visible changes.
