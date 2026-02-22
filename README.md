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
| Switch: Child Lock | Device child lock |
| Switch: LED Night Mode | LED indicator on/off |
| Switch: Mode AUTO ON/OFF | Dedicated switch: ON=`auto`, OFF=`sleep`; unavailable while Power OFF |
| Switch: Mode NIGHT ON/OFF | Dedicated switch: ON=`sleep`, OFF=`auto`; unavailable while Power OFF |
| Filter Maintenance | `filter1_life` as filter life level + change indication |

---

## Requirements

- Homebridge **1.11.1+** or **2.0+**
- Node.js **20.20+**, **22.22+**, or **24.13+**
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
| `connectTimeoutMs` | integer | No | MIIO handshake timeout in milliseconds (default `15000`) |
| `operationTimeoutMs` | integer | No | MIIO operation timeout in milliseconds (default `15000`) |
| `reconnectDelayMs` | integer | No | Base reconnect backoff delay in milliseconds (default `15000`) |
| `keepAliveIntervalMs` | integer | No | Keep-alive poll interval in milliseconds (default `60000`) |
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

### AQI mapping

| AQI range | HomeKit AirQuality |
|-----------|--------------------|
| 0–35 | Excellent |
| 36–70 | Good |
| 71–100 | Fair |
| > 100 | Poor |

### Mode switch (AUTO/NIGHT)

- One switch only: `ON => auto`, `OFF => sleep`.
- When `Power` is OFF, mode writes are intentionally rejected by plugin logic (`onSet` ignored and switch state refreshed from device); in HomeKit this behaves as non-accepting/unavailable control.
- Polling and write-after-read sync keep HomeKit, plugin state, and device state consistent.

### Filter life mapping

- `FilterLifeLevel` = `filter1_life`
- `FilterChangeIndication` = `CHANGE_FILTER` when `< 10%`, otherwise `FILTER_OK`

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
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

---

## AI Notice

This codebase was created entirely with the help of AI.

---

## License

MIT


## Test matrix (network + status resilience)

Automated Vitest scenarios cover:

1. Purifier restart detection + state refresh without Homebridge restart.
2. Router/Wi-Fi restart + reconnect and state resync.
3. Packet loss/timeouts + retry/backoff without crashes/flapping.
4. Homebridge restart bootstrap (initial state and switch set consistency).
5. Plugin hot reload (shutdown/init lifecycle without timer leaks/duplicates).
6. Short Wi-Fi outage (5-30s equivalent) with quick state restore.
7. Long Wi-Fi outage (retries exhausted, process stable, full resync after return).

Run tests:

```bash
npm test
```
