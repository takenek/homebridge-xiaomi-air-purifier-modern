# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately by emailing the maintainer or using
[GitHub's private vulnerability reporting](https://github.com/takenek/xiaomi-mi-air-purifier-ng/security/advisories/new).

Include:
- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

You will receive a response within **7 days**. If the vulnerability is confirmed,
a patch will be released as soon as possible (typically within 30 days for critical issues).

## Security Considerations

- **Device token**: The 32-character hex token required for LAN control is stored in plaintext in
  Homebridge's `config.json`. Treat it like a password: do not share it, do not commit it to version
  control, and rotate it if compromised (requires a device factory reset).
- **Local network only**: This plugin communicates exclusively over UDP on your LAN (port 54321).
  It never sends data to external servers or Xiaomi cloud.
- **Encryption**: Communication uses AES-128-CBC with keys derived from the device token, which is
  the standard MIIO protocol. The encryption keys are only as strong as your token security.
