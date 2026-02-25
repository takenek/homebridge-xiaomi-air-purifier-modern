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
| Air Quality Sensor | AQI mapped to 5 levels: Excellent / Good / Fair / Poor / Hazardous |
| Temperature Sensor | Current temperature |
| Humidity Sensor | Current relative humidity |
| Switch: Child Lock | Device child lock |
| Switch: LED Night Mode | LED indicator on/off |
| Switch: Mode AUTO ON/OFF | Dedicated switch: ON=`auto`, OFF=`sleep`; ignored while Power OFF |
| Switch: Mode NIGHT ON/OFF | Dedicated switch: ON=`sleep`, OFF=`auto`; ignored while Power OFF |
| Filter Maintenance | `filter1_life` as filter life level + change indication |
| Filter Replace Alert | Optional contact sensor for filter replacement warning (see config) |

---

## Requirements

- Homebridge **1.11.1+** or **2.0+**
- Node.js **20+**, **22+**, or **24+**
- Xiaomi Mi Air Purifier on the same LAN (UDP port 54321)
- Device token (32-character hex string)

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

Each purifier is configured as a separate accessory entry in `config.json`:

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
| `address` | string | Yes | LAN IP address of the device |
| `token` | string | Yes | 32-character hexadecimal token |
| `model` | string | Yes | Xiaomi model identifier (see table below) |
| `filterChangeThreshold` | integer | No | Percentage at or below which `FilterChangeIndication` is set to `CHANGE_FILTER` (default `10`, range `0–100`) |
| `exposeFilterReplaceAlertSensor` | boolean | No | Adds an optional HomeKit Contact Sensor for filter replacement alert (default `false`) |
| `connectTimeoutMs` | integer | No | MIIO handshake timeout in milliseconds (default `15000`, min `100`) |
| `operationTimeoutMs` | integer | No | MIIO read/write operation timeout in milliseconds (default `15000`, min `100`) |
| `reconnectDelayMs` | integer | No | Base delay for exponential reconnect backoff in milliseconds (default `15000`, min `100`) |
| `keepAliveIntervalMs` | integer | No | Background keep-alive poll interval in milliseconds (default `60000`, min `1000`) |
| `_bridge` | object | No | Standard Homebridge child bridge configuration |

### Supported models

| Device | Model string |
|--------|-------------|
| Mi Air Purifier 2H | `zhimi.airpurifier.2h` |
| Mi Air Purifier 3 | `zhimi.airpurifier.3` |
| Mi Air Purifier 3H | `zhimi.airpurifier.3h` |
| Mi Air Purifier 4 | `zhimi.airpurifier.4` |
| Mi Air Purifier Pro | `zhimi.airpurifier.pro` |

If your model is not listed the plugin will still attempt to connect using automatic MIOT/Legacy protocol detection.

---

## Token extraction

The device token is required for local LAN control. It is a 32-character hexadecimal string (e.g. `00112233445566778899aabbccddeeff`), not your Xiaomi account password.

> **Never share your token publicly.**
> Treat it like a password: do not commit it to version control. If compromised, a device factory reset is required.

Common extraction methods:

1. **Xiaomi cloud token extractors** – several open-source tools exist that retrieve tokens from the Xiaomi cloud API
2. **Android Mi Home backup** – extract from `mihome_xxxx.backup` SQLite databases
3. **iOS backup parsing** – use iMazing or direct SQLite access on `miio2.db`
4. **Packet capture during pairing** – advanced; capture UDP traffic on port 54321 during first setup

---

## HomeKit mapping details

### AQI mapping

The device reports raw PM2.5 concentration in μg/m³. The plugin maps this to the 5-level HomeKit Air Quality scale using Chinese GB3095-2012 thresholds:

| PM2.5 (μg/m³) | HomeKit AirQuality | Label |
|----------------|--------------------|-------|
| 0–35 | 1 | Excellent |
| 36–75 | 2 | Good |
| 76–115 | 3 | Fair |
| 116–150 | 4 | Poor |
| > 150 | 5 | Hazardous |

### Mode switches (AUTO / NIGHT)

Two separate switches are exposed in HomeKit:

| Switch | ON state | OFF state |
|--------|----------|-----------|
| `Mode AUTO ON/OFF` | device mode = `auto` | device mode = `sleep` |
| `Mode NIGHT ON/OFF` | device mode = `sleep` | device mode = `auto` |

**Important:** mode writes are silently ignored when the purifier `Power` is OFF. The plugin refreshes HomeKit switch state from the device after each rejected write, so the toggle snaps back to its actual position in the Home app.

### Filter life mapping

| HomeKit Characteristic | Source | Notes |
|------------------------|--------|-------|
| `FilterLifeLevel` | `filter1_life` | 0–100 % |
| `FilterChangeIndication` | `filter1_life <= filterChangeThreshold` | `CHANGE_FILTER` or `FILTER_OK` |
| `ContactSensorState` (optional) | same threshold | `CONTACT_NOT_DETECTED` = OK, `CONTACT_DETECTED` = replace |

The optional `Filter Replace Alert` contact sensor (`exposeFilterReplaceAlertSensor: true`) is provided as a workaround for Home app setups where the `FilterMaintenance` service notification is not surfaced visibly. Keep it disabled in most cases to avoid duplicate warnings.

---

## Polling and reconnect

| Channel | Interval | Purpose |
|---------|----------|---------|
| Operation poll | every **10 s** | power, mode, child lock, LED, fan level |
| Sensor poll | every **30 s** | temperature, humidity, AQI |
| Keep-alive | every **60 s** (configurable) | prevents session expiry |

On connection loss the plugin retries with exponential backoff and jitter (base delay set by `reconnectDelayMs`). All timers are cleared on Homebridge shutdown.

Connection lifecycle events are logged per device:

```
[Office Purifier] Connected to "Office Purifier" @ 10.10.1.17!
[Office Purifier] Disconnected from "Office Purifier" @ 10.10.1.17 (code ETIMEDOUT): MIIO timeout after 15000ms
[Office Purifier] Reconnected to "Office Purifier" @ 10.10.1.17.
```

---

## Troubleshooting

### Device not responding / timeout

1. Confirm the IP address is correct and static (use DHCP reservation)
2. Ensure UDP port 54321 is not blocked by your router or firewall
3. Confirm Homebridge host and purifier are on the same subnet
4. Power cycle the purifier and wait ~30 s before retrying
5. Increase `connectTimeoutMs` and `operationTimeoutMs` if the device is on a slow Wi-Fi segment

### Wrong or invalid token

- The token must be exactly 32 hexadecimal characters (digits `0–9` and letters `a–f` / `A–F`)
- The plugin will throw a clear error at startup if the token format is invalid
- After a factory reset the token changes; re-extract it

### Model differences

Some properties are model- or firmware-specific. The transport automatically detects the MIOT protocol first and falls back to the legacy MIIO `get_prop` API, so most model variants are handled transparently.

### Detailed reliability scenarios

Reconnect, Wi-Fi outage, and packet-loss behavior is documented with test case descriptions in [`docs/reliability-testing.md`](docs/reliability-testing.md).

---

## Development

```bash
npm ci

# Type checking
npm run typecheck

# Lint (check only)
npm run lint

# Lint + auto-fix formatting
npm run lint:fix

# Tests with coverage (100 % threshold enforced)
npm test

# Build TypeScript → dist/
npm run build
```

### Releasing

```bash
# Bump patch version (x.y.Z), commit, tag, push
npm run release:patch

# Bump minor version (x.Y.0)
npm run release:minor

# Bump major version (X.0.0)
npm run release:major
```

Publishing to npm is handled automatically by the [release workflow](.github/workflows/release.yml) when a version tag is pushed.

---

## AI Notice

This codebase was created entirely with the help of AI.

---

## License

MIT
