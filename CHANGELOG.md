# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates and PR template.
- `release.yml` workflow for npm publish with provenance (`npm publish --provenance`).
- Config validation for strict token format and supported model list.

### Changed
- Homebridge config/runtime parity for sensor toggles (`enableAirQuality`, `enableTemperature`, `enableHumidity`) and child-lock toggle (`enableChildLockControl`).
- Updated Node/Homebridge engine compatibility ranges to major lines (`20.x/22.x/24.x`, Homebridge `1.x/2.x`).
- CI hardening: workflow permissions, concurrency and npm audit job.
- Packaging metadata hardened (`displayName`, extended keywords, prepublish checks, OSS policy files in published package).
