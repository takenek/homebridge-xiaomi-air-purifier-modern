# homebridge-xiaomi-air-purifier-modern

[![CI](https://github.com/takenek/xiaomi-mi-air-purifier-ng/actions/workflows/ci.yml/badge.svg)](https://github.com/takenek/xiaomi-mi-air-purifier-ng/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/homebridge-xiaomi-air-purifier-modern)](https://www.npmjs.com/package/homebridge-xiaomi-air-purifier-modern)
[![Homebridge](https://img.shields.io/badge/Homebridge-1.11.1%2B%20%7C%202.0%2B-blueviolet)](https://homebridge.io)

Modern, production-quality Homebridge plugin for **Xiaomi Mi Air Purifier** (2H / 3 / 3H / 4 / Pro).

This plugin replaces the unmaintained [homebridge-xiaomi-mi-air-purifier](https://github.com/torifat/xiaomi-mi-air-purifier) plugin (last commit about 5 years ago) with a modern TypeScript implementation that uses only Node.js built-ins for protocol transport.

---

## Features

| HomeKit Service | Description |
|-----------------|-------------|
| Switch: Power | Main purifier power ON/OFF |
| Air Quality Sensor | AQI mapped to Excellent/Good/Fair/Poor |
| Temperature Sensor | Current temperature |
| Humidity Sensor | Current relative humidity |
| Switch: Child Lock | Optional control (`enableChildLockControl`) |
| Switch: LED Night Mode | LED indicator on/off |
| Switch: Mode AUTO ON/OFF | Dedicated switch: ON=`auto`, OFF=`sleep`; unavailable while Power OFF |
| Switch: Mode NIGHT ON/OFF | Dedicated switch: ON=`sleep`, OFF=`auto`; unavailable while Power OFF |
| Filter Maintenance | `filter1_life` as filter life level + change indication |

---

## Requirements

- Homebridge **1.11.1+** or **2.x**
- Node.js **20.x**, **22.x**, or **24.x**
- Xiaomi Mi Air Purifier on the same LAN (UDP 54321)
- Device token (32-char hex)

---

## Installation

### Homebridge UI

Search for `homebridge-xiaomi-air-purifier-modern` in the Homebridge plugin store.

### CLI

```bash
npm install -g homebridge-xiaomi-air-purifier-modern
```

---

## Configuration

Each purifier is configured as a separate accessory entry:

```json
"accessories": [
  {
    "accessory": "XiaomiMiAirPurifier",
    "name": "Office Purifier",
    "address": "10.10.1.17",
    "token": "00112233445566778899aabbccddeeff",
    "model": "zhimi.airpurifier.3h",
    "connectTimeoutMs": 15000,
    "operationTimeoutMs": 15000,
    "reconnectDelayMs": 15000,
    "keepAliveIntervalMs": 60000,
    "_bridge": {
      "name": "Xiaomi Mi Air Purifier HUB",
      "username": "11:22:33:44:55:66",
      "port": 35012
    }
  }
]
```

### Configuration fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accessory` | string | Yes | Must be `"XiaomiMiAirPurifier"` |
| `name` | string | Yes | HomeKit display name |
| `address` | string | Yes | LAN IP address |
| `token` | string | Yes | 32-character hex token |
| `model` | string | Yes | Xiaomi model identifier |
| `enableAirQuality` | boolean | No | Expose Air Quality Sensor service (default `true`) |
| `enableTemperature` | boolean | No | Expose Temperature Sensor service (default `true`) |
| `enableHumidity` | boolean | No | Expose Humidity Sensor service (default `true`) |
| `enableChildLockControl` | boolean | No | Expose Child Lock switch service (default `false`) |
| `filterChangeThreshold` | integer | No | Filter warning threshold in percent, warning is raised when `filter1_life` is at or below threshold (default `10`) |
| `exposeFilterReplaceAlertSensor` | boolean | No | Adds optional HomeKit `Filter Replace Alert` contact sensor workaround for Home app visibility (default `false`) |
| `connectTimeoutMs` | integer | No | MIIO handshake timeout in milliseconds (default `15000`) |
| `operationTimeoutMs` | integer | No | MIIO operation timeout in milliseconds (default `15000`) |
| `reconnectDelayMs` | integer | No | Base reconnect backoff delay in milliseconds (default `15000`) |
| `keepAliveIntervalMs` | integer | No | Keep-alive poll interval in milliseconds (default `60000`) |
| `maskDeviceAddressInLogs` | boolean | No | Masks device IP address in plugin logs (`10.10.*.*`) for privacy-sensitive setups (default `false`) |
| `_bridge` | object | No | Optional child bridge configuration |

### Known model strings

| Model | String |
|-------|--------|
| Mi Air Purifier 2H | `zhimi.airpurifier.2h` |
| Mi Air Purifier 3 | `zhimi.airpurifier.3` |
| Mi Air Purifier 3H | `zhimi.airpurifier.3h` |
| Mi Air Purifier 4 | `zhimi.airpurifier.4` |
| Mi Air Purifier Pro | `zhimi.airpurifier.pro` |

### Model / firmware support status

| Model | Firmware support level | Notes |
|-------|-------------------------|-------|
| Mi Air Purifier 2H (`zhimi.airpurifier.2h`) | Validated | Covered by integration-style read/write tests. |
| Mi Air Purifier 3 / 3H (`zhimi.airpurifier.3`, `zhimi.airpurifier.3h`) | Validated | Legacy + MIOT fallback paths validated. |
| Mi Air Purifier 4 / Pro (`zhimi.airpurifier.4`, `zhimi.airpurifier.pro`) | Validated | Primary MIOT mode and fallback paths validated. |
| Other `zhimi.airpurifier.*` variants | Best effort | Transport supports MIOT + legacy probing, but behavior may differ by firmware branch. |

---

## Token extraction

The token is required for local LAN control and is different from your Xiaomi account password.

> Never share your token publicly.

Common methods:

1. Xiaomi cloud token extractors
2. Android Mi Home backup parsing
3. iOS backup parsing (iMazing / SQLite)
4. Packet capture during pairing (advanced)

---

## HomeKit mapping details

### AQI mapping

| AQI range | HomeKit AirQuality |
|-----------|--------------------|
| 0–35 | Excellent |
| 36–70 | Good |
| 71–100 | Fair |
| > 100 | Poor |

### Mode switch (AUTO/NIGHT)

- Separate switches are exposed: `Mode AUTO ON/OFF` and `Mode NIGHT ON/OFF`.
- When `Power` is OFF, mode writes are intentionally rejected by plugin logic (`onSet` ignored and switch state refreshed from device); in HomeKit this behaves as non-accepting/unavailable control.
- Polling and write-after-read sync keep HomeKit, plugin state, and device state consistent.

### Filter life mapping

- `FilterLifeLevel` = `filter1_life`
- `FilterChangeIndication` = `CHANGE_FILTER` when `<= filterChangeThreshold` (default `10`), otherwise `FILTER_OK`
- Optional: `ContactSensorState` on `Filter Replace Alert` = `CONTACT_DETECTED` when replacement is needed, otherwise `CONTACT_NOT_DETECTED` (only when `exposeFilterReplaceAlertSensor: true`)

Default behavior keeps only `FilterMaintenance` to avoid duplicate warning presentation in Homebridge. Enable `exposeFilterReplaceAlertSensor` only if your Home app does not surface filter maintenance status.

Detailed resiliency test scenarios (restart/reconnect and Wi-Fi outage behavior) are documented in `docs/reliability-testing.md`.

---

## Polling and reconnect

- Operational polling: every **10s**
- Sensor polling: every **30s**
- Exponential backoff with jitter on reconnect attempts
- Timers are cleaned on Homebridge shutdown

The accessory logs connection lifecycle events per device:

```text
[Office Purifier] Connected to "Office Purifier" @ 10.10.1.17!
[Office Purifier] Disconnected from "Office Purifier" @ 10.10.1.17 (code ETIMEDOUT): MIIO timeout after 15000ms
[Office Purifier] Reconnected to "Office Purifier" @ 10.10.1.17.
```

---


## Network hardening (recommended)

Because MIIO uses local UDP (54321) without TLS, treat purifier traffic as trusted-LAN only:

1. Put IoT devices in a dedicated VLAN / SSID.
2. Allow only Homebridge host ↔ purifier UDP 54321 in ACL/firewall rules.
3. Block WAN egress from IoT VLAN when possible.
4. Enable `maskDeviceAddressInLogs` when log forwarding goes to shared SIEM or external support channels.

---

## Support & deprecation policy

- Supported runtime: active LTS Node versions listed in `package.json` engines.
- Homebridge support target: latest 1.x and current 2.x pre-release line (`beta`) validated in CI (full + smoke lanes).
- Deprecations are announced in `CHANGELOG.md` before removal in the next major version.

---

## Troubleshooting

### Device not responding / timeout

1. Verify IP and token
2. Ensure UDP 54321 is allowed on LAN
3. Confirm Homebridge host and purifier are on the same subnet
4. Power cycle purifier and retry

### Wrong token

- Token must be exactly 32 hex characters
- Regenerate token after device reset if needed

### Model differences

Some properties are model/firmware-specific. The transport supports both legacy MIIO and MIOT property APIs and falls back where possible.

---

## Development

```bash
export NODE_OPTIONS="--unhandled-rejections=strict --trace-warnings --trace-uncaught --throw-deprecation --pending-deprecation --trace-deprecation"
env -u npm_config_http_proxy -u npm_config_https_proxy npm ci
env -u npm_config_http_proxy -u npm_config_https_proxy npm run lint
env -u npm_config_http_proxy -u npm_config_https_proxy npm run typecheck
env -u npm_config_http_proxy -u npm_config_https_proxy npm test
env -u npm_config_http_proxy -u npm_config_https_proxy npm run build
```

---

## AI Notice

This codebase was created entirely with the help of AI.

---

## License

MIT
