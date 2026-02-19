# homebridge-xiaomi-air-purifier-modern

[![CI](https://github.com/takenek/xiaomi-mi-air-purifier-ng/actions/workflows/ci.yml/badge.svg)](https://github.com/takenek/xiaomi-mi-air-purifier-ng/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/homebridge-xiaomi-air-purifier-modern)](https://www.npmjs.com/package/homebridge-xiaomi-air-purifier-modern)
[![Homebridge](https://img.shields.io/badge/Homebridge-1.8%2B%20%7C%202.0%2B-blueviolet)](https://homebridge.io)

Modern, production-quality Homebridge plugin for **Xiaomi Mi Air Purifier** (2H / 3 / 3H / 4 / Pro).

This plugin replaces the unmaintained [homebridge-xiaomi-mi-air-purifier](https://github.com/takenek/xiaomi-mi-air-purifier) plugin with a modern TypeScript implementation that uses only Node.js built-ins for protocol transport.

---

## Features

| HomeKit Service | Description |
|-----------------|-------------|
| Fan v2 | Power on/off + rotation speed (fan level mapped to 0–100%) |
| Air Quality Sensor | AQI mapped to Excellent/Good/Fair/Poor |
| Temperature Sensor | Current temperature |
| Humidity Sensor | Current relative humidity |
| Switch: Child Lock | Device child lock |
| Switch: LED Night Mode | LED indicator on/off |
| Switch: Auto Mode | Sets device to `auto` mode |
| Switch: Sleep Mode | Sets device to `sleep` mode |
| Filter Maintenance | `filter1_life` as filter life level + change indication |

---

## Requirements

- Homebridge **1.8+** or **2.0+**
- Node.js **20+**
- Xiaomi Mi Air Purifier on the same LAN (UDP 54321)
- Device token (32-char hex)

---

## Installation

### Homebridge UI

Search for `homebridge-xiaomi-air-purifier-modern` in the Homebridge plugin store.

### CLI

```bash
env -u npm_config_http_proxy -u npm_config_https_proxy npm install -g homebridge-xiaomi-air-purifier-modern
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
| `_bridge` | object | No | Optional child bridge configuration |

### Known model strings

| Model | String |
|-------|--------|
| Mi Air Purifier 2H | `zhimi.airpurifier.2h` |
| Mi Air Purifier 3 | `zhimi.airpurifier.3` |
| Mi Air Purifier 3H | `zhimi.airpurifier.3h` |
| Mi Air Purifier 4 | `zhimi.airpurifier.4` |
| Mi Air Purifier Pro | `zhimi.airpurifier.pro` |

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

### Fan speed mapping

```text
RotationSpeed = round((fan_level - 1) / 15 * 100)
fan_level     = round(RotationSpeed / 100 * 15 + 1)
```

### AQI mapping

| AQI range | HomeKit AirQuality |
|-----------|--------------------|
| 0–35 | Excellent |
| 36–70 | Good |
| 71–100 | Fair |
| > 100 | Poor |

### Mode switches

- Auto switch ON → `set_mode("auto")`
- Sleep switch ON → `set_mode("sleep")`
- Turning OFF active switch → `set_mode("idle")`
- Polling synchronizes switch state with real device mode

### Filter life mapping

- `FilterLifeLevel` = `filter1_life`
- `FilterChangeIndication` = `CHANGE_FILTER` when `< 10%`, otherwise `FILTER_OK`

---

## Polling and reconnect

- Operational polling: every **10s**
- Sensor polling: every **30s**
- Exponential backoff with jitter on reconnect attempts
- Timers are cleaned on Homebridge shutdown

The accessory also logs successful first connection per device, for example:

```text
[Office Purifier] Connected to "Office Purifier" @ 10.10.1.17!
```

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

## License

MIT
