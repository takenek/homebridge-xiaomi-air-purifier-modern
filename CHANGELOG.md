# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Commit linting in CI (Conventional Commits enforcement for pull requests).
- Semantic-release configuration (`.releaserc.json`) for automatic versioning, changelog updates, GitHub releases and npm publishing.
- Homebridge compatibility smoke-test job (`1.x` and experimental `2.x`) in CI.
- Security hardening guidance for LAN deployments and token/log redaction recommendations in docs.
- Support window and deprecation policy documentation in README/CONTRIBUTING.

### Changed
- CI quality gates now include explicit `npm run build`.
- Release workflow migrated from manual tag-driven `npm publish` to semantic-release on `main` with npm provenance enabled.
- `package.json` release scripts migrated to `semantic-release` and release-related dev dependencies added.
- Release checklist updated for automated release flow.

