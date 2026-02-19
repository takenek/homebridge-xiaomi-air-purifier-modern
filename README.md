# homebridge-xiaomi-air-purifier-modern

Nowoczesna, utrzymywalna wtyczka Homebridge dla Xiaomi Mi Air Purifier (2H/3/3H/4/Pro), kompatybilna z Homebridge 1.8+ i 2.0+.

## Features
- Fan v2: `On` i `RotationSpeed` (mapowanie `fan_level` 1-16)
- Air Quality Sensor (AQI -> HomeKit AirQuality)
- Temperature + Humidity
- Switch: Child Lock, LED Night Mode, Auto Mode, Sleep Mode
- Battery service jako `filter1_life`
- Polling: operacyjny 10s, sensory 30s
- Retry/backoff wykładniczy z jitterem

## Installation
```bash
env -u npm_config_http_proxy -u npm_config_https_proxy npm i -g homebridge-xiaomi-air-purifier-modern
```

## Homebridge config (multi-device)
```json
{
  "accessories": [
    {
      "accessory": "XiaomiMiAirPurifier",
      "name": "Salon Purifier",
      "address": "192.168.1.50",
      "token": "0123456789abcdef0123456789abcdef",
      "model": "zhimi.airpurifier.4"
    },
    {
      "accessory": "XiaomiMiAirPurifier",
      "name": "Bedroom Purifier",
      "address": "192.168.1.51",
      "token": "fedcba9876543210fedcba9876543210",
      "model": "zhimi.airpurifier.3h",
      "_bridge": {
        "name": "Bedroom Bridge",
        "username": "0E:0D:0C:0B:0A:09",
        "port": 51829
      }
    }
  ]
}
```

## Token extract
Najczęściej:
1. Mi Home backup extraction (Android)
2. Router traffic capture podczas pairing
3. Narzędzia community (uważaj na bezpieczeństwo tokena)

Nigdy nie publikuj tokena publicznie.

## Troubleshooting
- **Wrong token**: `Unauthorized`/timeout, zweryfikuj 32-znakowy token.
- **LAN blocked**: włącz lokalny dostęp i reguły firewall.
- **Timeout/reconnect**: plugin stosuje retry/backoff i wraca do pollingu po recovery.
- **Model differences**: upewnij się, że `model` odpowiada urządzeniu.

## Development
Użyj:
```bash
export NODE_OPTIONS="--unhandled-rejections=strict --trace-warnings --trace-uncaught --throw-deprecation --pending-deprecation --trace-deprecation"
env -u npm_config_http_proxy -u npm_config_https_proxy npm ci
env -u npm_config_http_proxy -u npm_config_https_proxy npm run lint
env -u npm_config_http_proxy -u npm_config_https_proxy npm run typecheck
env -u npm_config_http_proxy -u npm_config_https_proxy npm test
env -u npm_config_http_proxy -u npm_config_https_proxy npm run build
```
