# Release checklist

- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm ci`
- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm run lint`
- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm run typecheck`
- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm test` (coverage thresholds are 100% lines/functions/branches/statements)
- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm run build`
- [ ] `env -u npm_config_http_proxy -u npm_config_https_proxy npm pack --dry-run` and verify package contents
- [ ] Review `CHANGELOG.md`
- [ ] Publish flow: semantic-release workflow on `main` (preferred) or emergency manual tag release
