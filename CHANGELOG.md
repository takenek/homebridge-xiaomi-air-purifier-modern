# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-25

### Added

- Initial modern Homebridge plugin implementation for Xiaomi Mi Air Purifier (2H/3/3H/4/Pro).
- Accessory plugin with full HomeKit service support: Power, Air Quality, Temperature, Humidity,
  Child Lock, LED, Mode AUTO/NIGHT switches, Filter Maintenance, and optional Filter Replace Alert.
- MIIO protocol transport with automatic MIOT/Legacy protocol detection and fallback.
- Exponential backoff with jitter for connection retries (`retry.ts`).
- Serialised operation queue in `DeviceClient` to prevent race conditions.
- Configurable polling intervals (operation: 10 s, sensor: 30 s, keep-alive: 60 s).
- 100% test coverage (lines/branches/functions/statements) excluding network transport.
- CI/CD pipeline (lint, typecheck, test, build, audit) across Node 20/22/24.
- Automated npm publish workflow triggered on version tags.
- `config.schema.json` for Homebridge Config UI X.
- Full OSS documentation: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md.

[1.0.0]: https://github.com/takenek/xiaomi-mi-air-purifier-ng/releases/tag/v1.0.0
