# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0.0 | ❌ |

Runtime support targets are aligned with `package.json` (`engines` and `peerDependencies`).

## Reporting a Vulnerability

Please do **not** open public GitHub issues for security vulnerabilities.

Report vulnerabilities by opening a private GitHub Security Advisory in this repository.
Include:

- affected version,
- reproduction steps,
- potential impact,
- proposed remediation (if available).

## Response Targets

- Initial triage response: within **72 hours**.
- Status update after triage: within **7 days**.
- Fix timeline depends on severity and exploitability.

## Disclosure

After a fix is released, we will disclose:

- affected versions,
- mitigation/fixed version,
- relevant changelog entry.

## LAN hardening guidance

The plugin communicates with Xiaomi devices over local LAN (MIIO/UDP). To reduce risk:

- isolate IoT devices (VLAN / dedicated SSID),
- limit purifier network reachability to the Homebridge host,
- avoid sharing tokens and full network traces/logs in public channels.
