# homebridge-xiaomi-air-purifier-modern

[![CI](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/actions/workflows/ci.yml/badge.svg)](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/homebridge-xiaomi-air-purifier-modern)](https://www.npmjs.com/package/homebridge-xiaomi-air-purifier-modern)
[![Homebridge](https://img.shields.io/badge/Homebridge-2.0.2%2B-blueviolet)](https://homebridge.io)
[![Node](https://img.shields.io/badge/Node.js-22.12%2B%20%7C%2024.x%20%7C%2026.x-green)](https://nodejs.org)

Modern, production-quality Homebridge plugin for **Xiaomi Mi Air Purifier** (2H / 2S / 3 / 3H / 4 / Pro).

Built from scratch in TypeScript on top of Node.js built-ins (no native dependencies, no external HTTP traffic), targeting Homebridge 2.x and current LTS Node.js (22.x / 24.x / 26.x).

---

## Features

| HomeKit Service | Description |
|-----------------|-------------|
| AirPurifier | Main purifier power ON/OFF. Uses the native AirPurifier service with `Active`, `CurrentAirPurifierState`, `TargetAirPurifierState`, and `RotationSpeed` characteristics. |
| Air Quality Sensor | AQI mapped to Excellent/Good/Fair/Poor + PM2.5 Density |
| Temperature Sensor | Current temperature |
| Humidity Sensor | Current relative humidity |
| Switch: Child Lock | Optional control (`enableChildLockControl`) |
| Switch: LED Night Mode | LED indicator on/off |
| Switch: Mode AUTO ON/OFF | Dedicated switch: ON=`auto`, OFF=`sleep` (`silent` on legacy miIO firmware); unavailable while Power OFF |
| Switch: Mode NIGHT ON/OFF | Dedicated switch: ON=`sleep` (`silent` on legacy miIO firmware), OFF=`auto`; unavailable while Power OFF |
| Filter Maintenance | `filter1_life` as filter life level + change indication |
| Contact Sensor: Filter Replace Alert | Optional extra sensor for filter replacement warning (`exposeFilterReplaceAlertSensor`, default `false`) |

### How this plugin compares to other Xiaomi air-purifier plugins

| Capability | `homebridge-xiaomi-mi-air-purifier` (verified, last release 2020) | `homebridge-xiaomi-air-purifier-modern` (this plugin) |
|------------|-------------------------------------------------------------------|--------------------------------------------------------|
| Homebridge target | Homebridge 1.x | **Homebridge 2.x** (native `AirPurifier` service with `Active` / `CurrentAirPurifierState` / `TargetAirPurifierState` / `RotationSpeed`) |
| Node.js | Legacy (Node 10/12) | **Node 22 LTS, Node 24 LTS and Node 26 LTS** |
| Implementation | JavaScript + abandoned `miio` dependency | **TypeScript**, Node `dgram` only, zero runtime deps |
| Supported models | 2 / 2S (`zhimi.airpurifier.m1`, `m2`) | **2H, 2S, 3, 3H, 4, Pro** (`zhimi.airpurifier.2h/2s/3/3h/4/pro`) — MIOT + legacy MIIO transports |
| Multi-device | Single accessory | **Dynamic platform** with multiple devices in one instance |
| Reconnect / resilience | Manual restart on failure | **Exponential backoff with jitter** + automatic UDP transport reset to recover from `MIIO error -5001` stuck state |
| Mode handling | One switch, `auto` only | **Separate AUTO / NIGHT switches** with state sync after writes |
| Filter status | None | `FilterMaintenance` (life + change indication) + optional `Filter Replace Alert` contact sensor |
| Settings GUI | Minimal | **Full `config.schema.json`** with grouped fieldsets, validation, password-masked token field |
| Tests | None | **100 % coverage** (statements / branches / functions / lines) on Vitest v5 + v8 |
| Maintenance | Last release 2020 | Active — semantic-release pipeline with GitHub releases per version |

This plugin is intended for users on Homebridge 2.x with the newer hardware (model **3 / 3H / 4 / Pro**), where the legacy verified plugin does not provide working transport.

---

## Requirements

- Homebridge **2.0.2** or newer (Homebridge 1.x is no longer supported)
- Node.js **22.12.0** or newer on the 22.x line, **24.x** or **26.x** (Node 20 reached end-of-life and is no longer supported)
  - on **Node 26** you need Homebridge **2.3.0** or newer — that is the first Homebridge release that itself runs on Node 26
- npm **>=10.0.0**
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

This is a **Dynamic Platform Plugin**. Add it under the `platforms` array with a `devices` list:

```json
"platforms": [
  {
    "platform": "XiaomiMiAirPurifier",
    "devices": [
      {
        "name": "Office Purifier",
        "address": "10.10.1.17",
        "token": "00112233445566778899aabbccddeeff",
        "model": "zhimi.airpurifier.3h",
        "connectTimeoutMs": 15000,
        "operationTimeoutMs": 15000,
        "reconnectDelayMs": 15000,
        "keepAliveIntervalMs": 60000
      }
    ]
  }
]
```

### Configuration fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Must be `"XiaomiMiAirPurifier"` |
| `name` | string | Yes | HomeKit display name (per device) |
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
| `reconnectDelayMs` | integer | No | Maximum reconnect backoff delay cap in milliseconds — first retry starts fast (~400 ms base), subsequent retries grow exponentially up to this ceiling (default `15000`) |
| `keepAliveIntervalMs` | integer | No | Keep-alive poll interval in milliseconds (default `60000`, min `1000`) |
| `operationPollIntervalMs` | integer | No | Polling interval for control-related state refresh in milliseconds (default `10000`, min `1000`) |
| `sensorPollIntervalMs` | integer | No | Polling interval for slower sensor updates (temperature, humidity, AQI) in milliseconds (default `30000`, min `1000`) |
| `transportResetThreshold` | integer | No | After this many consecutive failed polls the plugin recreates the underlying UDP socket and MIIO session — equivalent to restarting Homebridge, but automatic. Set to `0` to disable. Default `12` (≈2 min at the default 10 s operation cadence). |
| `transportResetCooldownMs` | integer | No | Minimum delay between two consecutive automatic transport resets, in milliseconds. Prevents reset thrashing when the device is genuinely unreachable. Default `300000` (5 min). |
| `maskDeviceAddressInLogs` | boolean | No | Masks the device IP address in plugin logs (`10.10.*.*`). **Enabled by default**; set to `false` only if you need the full IP in logs |
| `_bridge` | object | No | Optional child bridge configuration |

### Known model strings

| Model | String |
|-------|--------|
| Mi Air Purifier 2H | `zhimi.airpurifier.2h` |
| Mi Air Purifier 2S | `zhimi.airpurifier.2s` |
| Mi Air Purifier 3 | `zhimi.airpurifier.3` |
| Mi Air Purifier 3H | `zhimi.airpurifier.3h` |
| Mi Air Purifier 4 | `zhimi.airpurifier.4` |
| Mi Air Purifier Pro | `zhimi.airpurifier.pro` |

### Model / firmware support status

| Model | Firmware support level | Notes |
|-------|-------------------------|-------|
| Mi Air Purifier 2H (`zhimi.airpurifier.2h`) | Validated | Legacy miIO (Xiaomi id `zhimi.airpurifier.mc2`), sharing the legacy transport with the 2S. The purifier from [#297](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/297), reported there as a 2S and identified in [#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298) as an `mc2` (firmware 1.4.3_23101), confirmed power, auto/manual mode, AQI/PM2.5, humidity, filter and the `temp_dec` temperature scale on plugin 1.0.9. In [#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298) it rejected `set_level_fan` and accepted favorite levels 0–16, and the reporter confirmed that Rotation Speed works on plugin 1.1.1 (the fan follows the slider and Auto switches to Manual). Night mode (`silent`) is covered by unit tests. |
| Mi Air Purifier 2S (`zhimi.airpurifier.2s`) | Best effort | Legacy miIO only (Xiaomi ids `zhimi.airpurifier.ma1`, `ma2`, `mc1`, `mb1`), on the same transport as the 2H. The purifier reported as a 2S in [#297](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/297) identified itself via `miIO.info` in [#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298) as `zhimi.airpurifier.mc2` (2H), so no 2S has been confirmed on real hardware yet. The `ma2` is documented to accept favorite levels up to 14; see [Rotation Speed and fan mode](#rotation-speed-and-fan-mode). |
| Mi Air Purifier 3 / 3H (`zhimi.airpurifier.3`, `zhimi.airpurifier.3h`) | Validated | MIOT validated on the 3H, which answers legacy miIO commands only with `MIIO error -5001`. The miot-spec limits the favorite level of the 3 (`ma4`) and the 3H (`mb3`) to 0–14, and a 3H refused level 16 on plugin 1.1.2, so Rotation Speed tops out at 87 %; see [Rotation Speed and fan mode](#rotation-speed-and-fan-mode). |
| Mi Air Purifier 4 / Pro (`zhimi.airpurifier.4`, `zhimi.airpurifier.pro`) | Validated | Primary MIOT mode and fallback paths validated. |
| Other `zhimi.airpurifier.*` variants | Best effort | Transport supports MIOT + legacy probing, but behavior may differ by firmware branch. |

---

## Token extraction

The token is required for local LAN control and is different from your Xiaomi account password.

> Never share your token publicly — it grants full LAN control of the device.

Recommended tools (community-maintained, well-known):

1. **[Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor)** — Python script that signs into your Mi Home account and prints tokens for all paired devices. The easiest method when you still have access to the Mi Home account that paired the device.
2. **[python-miio](https://github.com/rytilahti/python-miio)** — `miiocli` CLI can read tokens stored locally and discover devices on the LAN (`miiocli discover --handshake true`).
3. **Android — Mi Home backup parsing**: install Mi Home **5.4.54** (older version that keeps tokens unencrypted), pair the device, then extract the SQLite database from `/data/data/com.xiaomi.smarthome/databases/miio2.db`.
4. **iOS — iMazing backup parsing**: read tokens from the encrypted Mi Home backup using [this guide](https://www.openhab.org/addons/bindings/miio/#discovery).
5. **Packet capture during pairing** (advanced) — Wireshark on the IoT VLAN during the initial Mi Home pairing flow.

The token must be exactly **32 hexadecimal characters** (`0-9`, `a-f`). The plugin will reject any other format with a clear error in the Homebridge log.

---

## HomeKit mapping details

### AQI mapping

| AQI range | HomeKit AirQuality |
|-----------|--------------------|
| < 0 / NaN | UNKNOWN (0) |
| 0–35 | Excellent (1) |
| 36–75 | Good (2) |
| 76–115 | Fair (3) |
| 116–150 | Poor (4) |
| > 150 | Inferior (5) |

### PM2.5 Density

The Air Quality Sensor service exposes `PM2_5Density` set to the raw AQI value reported by the device's PM2.5 sensor (clamped to `[0, 1000]`). Note: the device reports an AQI index derived from its PM2.5 sensor, not a direct µg/m³ measurement. In practice the values are close (especially in the 0–500 range), and this mapping is the standard approach used across the Homebridge ecosystem for Xiaomi purifiers.

### Temperature

`CurrentTemperature` is published in °C. MIOT models report degrees directly, and the value is passed through unchanged. Legacy miIO firmware (2S, 2H, 2, Pro) reports the temperature as `temp_dec`, in tenths of a degree (`233` = 23.3 °C). The plugin reads `temp_dec` first and divides it by 10, so the reading is correct at any room temperature, including below 10 °C. The legacy `temperature` property, which is already in degrees, is used only as a fallback when `temp_dec` is not available.

### Rotation Speed and fan mode

Setting **Rotation Speed** in HomeKit automatically switches the device to `favorite` mode, because the manual fan speed only applies there, and maps 0–100 % to level 1–16. The mode change is reflected in the HomeKit Mode switches after the next state poll.

- MIOT models receive `set_properties` for the mode (siid 2 piid 5) and then for the favorite level (siid 10 piid 10). The 3H (`zhimi.airpurifier.mb3`) is documented to accept favorite levels 0–14 (miot-spec), and a 3H refused level 16 in the reply on plugin 1.1.2. A reply that refuses a value keeps the plugin on MIOT: a refused favorite level is retried one level lower (see below), and any other refused value fails the HomeKit write. Only a reply that is not a MIOT result list makes the plugin fall back to legacy commands.
- Legacy miIO firmware (2S, 2H, 2, Pro) does not implement `set_level_fan`: the 2H (`mc2`) rejects it with `MIIO error -32601: Method not found` ([#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298)), and python-miio, Home Assistant and other Xiaomi integrations never send it to these models. The plugin sends `set_mode ["favorite"]` followed by `set_level_favorite [level]` instead. The 2H accepts favorite levels 0–16. The 2S `ma2` is documented to accept favorite levels only up to 14 (miot-spec, home-assistant/core#94437).
- If the purifier rejects a favorite level (legacy firmware with `MIIO error -5001`, MIOT firmware by refusing the value in the `set_properties` reply), the plugin tries one level lower at a time and treats the first level the purifier accepts as its maximum, unless the purifier already accepted a higher level. The maximum is kept until Homebridge restarts or the automatic transport reset (see [Polling and reconnect](#polling-and-reconnect)) rebuilds the connection. Later slider positions above that level set it directly, and the slider shows the level the purifier actually runs at (for example 87 % for level 14). MIOT firmware refuses a value explicitly, so the plugin can go down to level 1; a property that is not writable or does not exist (item code `-4002` or `-4003`) fails at once. On legacy firmware the plugin stops at level 10 and reports a lower rejected level as a failed write, because legacy firmware that rejects valid commands with `-5001` is usually in the stuck state described under [Polling and reconnect](#polling-and-reconnect).

### Mode switch (AUTO/NIGHT)

- Separate switches are exposed: `Mode AUTO ON/OFF` and `Mode NIGHT ON/OFF`.
- When `Power` is OFF, mode writes are intentionally rejected by plugin logic (`onSet` ignored and switch state refreshed from device); in HomeKit this behaves as non-accepting/unavailable control.
- Polling and write-after-read sync keep HomeKit, plugin state, and device state consistent.
- Legacy miIO firmware (2S, 2H, 2, Pro) names night mode `silent` instead of `sleep` and rejects `sleep` with `MIIO error -5001`. The plugin translates between the two automatically: a device reporting `silent` turns the NIGHT switch ON, and the NIGHT switch sends `set_mode ["silent"]` to such devices. MIOT models are unaffected.

### Filter life mapping

- `FilterLifeLevel` = `filter1_life`
- `FilterChangeIndication` = `CHANGE_FILTER` when `<= filterChangeThreshold` (default `10`), otherwise `FILTER_OK`
- Optional: `ContactSensorState` on `Filter Replace Alert` = `CONTACT_NOT_DETECTED` (open = alert) when replacement is needed, otherwise `CONTACT_DETECTED` (closed = normal) (only when `exposeFilterReplaceAlertSensor: true`)

Default behavior keeps only `FilterMaintenance` to avoid duplicate warning presentation in Homebridge. Enable `exposeFilterReplaceAlertSensor` only if your Home app does not surface filter maintenance status.

Detailed resiliency and status scenarios (restart/reconnect, Wi-Fi outage behavior, and filter replacement signaling) are documented in [`docs/reliability-test-plan.md`](./docs/reliability-test-plan.md) and automated in [`test/network-scenarios.test.ts`](./test/network-scenarios.test.ts).

---

## Polling and reconnect

- Operational polling: every **10s**
- Sensor polling: every **30s**
- Exponential backoff with jitter on reconnect attempts
- **Auto transport recovery**: after `transportResetThreshold` consecutive failed polls (default `12`, ≈2 min), the plugin tears down the UDP socket and MIIO session and rebuilds them from scratch — automatically performing what would otherwise require a Homebridge restart. This recovers from device-side stuck states (e.g. firmware that keeps replying `MIIO error -5001` until the source UDP port rotates), most common on older `zhimi.airpurifier.pro` units. A `transportResetCooldownMs` (default 5 min) prevents thrashing when the device is genuinely offline.
- `MIIO error -5001` and `-10000` are now retried with a tight cap of 2 attempts per call before propagating, instead of failing immediately on the first attempt.
- Timers are cleaned on Homebridge shutdown

Every device-specific log line is prefixed with the configured device name
(`[<name>]`), so with multiple purifiers you can always tell which one a message
refers to — this covers low-level transport and poll-failure diagnostics, not
just the connection lifecycle events:

```text
[Office Purifier] Connected to "Office Purifier" @ 10.10.1.17!
[Office Purifier] Disconnected from "Office Purifier" @ 10.10.1.17 (code ETIMEDOUT): MIIO timeout after 15000ms
[Office Purifier] Reconnected to "Office Purifier" @ 10.10.1.17.
[Office Purifier] Device read failed (attempt 1, code ETIMEDOUT): MIIO timeout after 15000ms
[Office Purifier] Persistent device errors (12 consecutive failures, last code -5001) — recreating MIIO transport (new UDP socket, fresh handshake) to break stuck device-side state.
```

---


## Network hardening (recommended)

Because MIIO uses local UDP (54321) without TLS, treat purifier traffic as trusted-LAN only:

1. Put IoT devices in a dedicated VLAN / SSID.
2. Allow only Homebridge host ↔ purifier UDP 54321 in ACL/firewall rules.
3. Block WAN egress from IoT VLAN when possible.
4. Keep `maskDeviceAddressInLogs` enabled (the default) when log forwarding goes to a shared SIEM or external support channels.

### Device response integrity

Responses from the device are authenticated defensively before they are trusted:

- The token-keyed MD5 checksum on every reply is **enforced fail-closed** — a datagram whose checksum does not match is rejected (treated as a transient transport error and retried), never decrypted or acted upon. Only a party holding the device token can produce a valid checksum.
- The decrypted response id is correlated with the request id, so a captured/replayed reply belonging to a different request is not accepted.
- Only datagrams originating from the configured device address and MIIO port are accepted; packets from any other source on the LAN are ignored.

These checks reduce the risk of response spoofing/replay on an untrusted LAN, but they are defence-in-depth — network segmentation (above) is still the primary control.

---

## Privacy and data flow

- The plugin communicates **only** with the configured purifier over LAN UDP 54321 (MIIO/MIOT). No data is sent to the Xiaomi cloud, no telemetry, no analytics, no error reporting to any external service.
- Runtime dependencies: **zero** — the published package depends only on Node.js built-ins (`node:dgram`, `node:crypto`, `node:net`, etc.).
- The plugin does not write any files to disk. All Homebridge accessory state is managed by Homebridge itself in the user's storage directory (`api.user.storagePath()`); the plugin only reads it back via the standard `configureAccessory` callback.
- Tokens are read from `config.json` only and are never logged, never forwarded, and never persisted anywhere else.

---

## Support & deprecation policy

- Supported runtime: active LTS Node versions listed in `package.json` engines (currently **Node 22.12+**, **Node 24.x** and **Node 26.x**).
- Homebridge support target: stable **2.0.2+**, validated in CI against Homebridge **2.0.2** on Node 22 and Node 24, and against Homebridge **2.3.0** on Node 26 (Homebridge 2.0.x – 2.2.x do not support Node 26).
- Node.js **26.x** (LTS since October 2026) is supported from plugin **v1.1.4** (with Homebridge **2.3.0+**). On Node 26, plugin **v1.0.9 – v1.1.3** make Homebridge log the warning *"requires a Node.js version of ^22.12.0 || ^24.0.0 which does not satisfy the current Node.js version"* (older releases print the same warning with their own range). Homebridge still loads the plugin, but those releases were never tested on Node 26 — update the plugin to clear the warning.
- Homebridge **1.x** support has been dropped — users on Homebridge 1.x must **stay on plugin v1.0.2** or upgrade Homebridge to 2.x.
- Node.js **20.x** support has been dropped (end-of-life) — users on Node 20 must **stay on plugin v1.0.2** or upgrade Node.js to 22.12+ / 24.x / 26.x.
- Node.js **22.0.x – 22.11.x** are no longer supported — the minimum on the 22.x line is now **22.12.0** (the dev toolchain requires it, and it is the range Homebridge 2.x asks plugin authors to declare). Users on an earlier 22.x release must **stay on plugin v1.0.8** or upgrade Node.js to 22.12+ / 24.x / 26.x.
- Deprecations are announced in `CHANGELOG.md` before removal in the next major version.
- **Dynamic Platform Plugin** — supports multiple devices in a single plugin instance with automatic cached accessory management. See `config.schema.json` for the full schema.

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

### Temperature shows 100 °C or Homebridge logs `exceeded maximum of 100` (Mi Air Purifier 2S / 2H)

Up to version 1.0.9 the plugin published the legacy `temp_dec` value (tenths of a degree, e.g. `233` for 23.3 °C) without scaling it. HomeKit clamped it to 100 °C, and Homebridge logged `characteristic was supplied illegal value: number 233 exceeded maximum of 100`. Below 10 °C the raw value is 100 or less, so it was shown as e.g. 95 °C without any warning.

Update the plugin. The temperature is scaled correctly whichever model you select, and the HomeKit accessory is kept. If you patched `dist/accessories/air-purifier.js` by hand (the workaround from [#297](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/297)), the update replaces the patched file, so there is nothing to revert.

### Purifier stops responding in the Home app after Rotation Speed is set to 90–100 % (3H and other MIOT models)

Up to version 1.1.2 the plugin sent favorite level 15 or 16 for 90–100 %. The 3H accepts favorite levels only up to 14 (miot-spec) and refused level 16. The plugin then switched itself to legacy miIO commands, which the 3H answers only with `MIIO error -5001: command error`. Homebridge logged `Setting Rotation Speed failed: MIIO error -5001: command error` and then a series of `Device read failed (attempt …, code -5001)`. The accessory stopped responding until the automatic transport reset rebuilt the connection, or until Homebridge restarted. By default that reset happens after 12 consecutive failed polls and at most once every 5 minutes (`transportResetThreshold`, `transportResetCooldownMs`; see [Polling and reconnect](#polling-and-reconnect)). Meanwhile the purifier stayed in favorite mode.

Update the plugin. It now stays on MIOT, sets favorite level 14 for 90–100 % on the 3H, and logs any other refused value as `Setting <characteristic> failed: MIOT property <siid>.<piid> rejected the value (code …)`.

### Rotation Speed slider jumps back and Homebridge logs `Method not found` (legacy miIO, e.g. 2H / 2S)

Up to version 1.1.0 the plugin wrote Rotation Speed on legacy miIO purifiers with `set_level_fan`, a method this firmware does not have. Every slider change failed, the slider jumped back after a few seconds, and Homebridge logged `This plugin threw an error from the characteristic 'Rotation Speed': Unhandled error thrown inside write handler for characteristic: MIIO error -32601: Method not found.` ([#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298)).

Update the plugin. It now switches the purifier to favorite mode and sets the favorite level; see [Rotation Speed and fan mode](#rotation-speed-and-fan-mode). A write the purifier still rejects is logged as `Setting Rotation Speed failed: <reason>` and reported to HomeKit as a communication failure.

### `Failed to configure device: Invalid or missing config field: address`

This error means at least one entry in the `devices` array is empty or
incomplete — typically a leftover entry created by clicking **Add Device** in
Homebridge UI without filling in `address`, `token`, or `model`. Three real
purifiers may still appear correctly in HomeKit while a fourth ghost entry
keeps producing this error on every restart.

Starting with this release the message names the offending entry, e.g.

```text
Failed to configure device #4 ("Air Purifier"): missing required config fields: address, token, model
```

To inspect your saved configuration safely (the `jq` filter strips `token`
values so you can paste output without leaking secrets):

```bash
jq '.platforms[]
    | select(.platform == "XiaomiMiAirPurifier")
    | .devices
    | map(del(.token))' \
  ~/.homebridge/config.json
```

Remove the empty entry (or fill in the missing fields), save the file, then
restart the **child bridge** for `XiaomiMiAirPurifier` from Homebridge UI — or
restart Homebridge entirely if you do not run this plugin in a child bridge.
Cached HomeKit accessories for the three working purifiers are unaffected by
this fix; their UUIDs are derived from the device IP and remain stable.

### Model differences

Some properties are model/firmware-specific. The transport supports both legacy MIIO and MIOT property APIs and falls back where possible.

- **Protocol is auto-detected, not taken from `model`.** The `model` field only sets the Model shown in HomeKit. The plugin probes MIOT first and falls back to legacy miIO, which is what the 2S and 2H use. The accessory UUID is derived from the IP address, so changing `model` keeps the existing HomeKit accessory, rooms and automations.
- **Temperature on legacy miIO** is read from `temp_dec` (tenths of a degree) and scaled to °C; see [Temperature](#temperature).
- **Night mode on legacy miIO** is called `silent`; see [Mode switch (AUTO/NIGHT)](#mode-switch-autonight).
- **Rotation Speed on legacy miIO** is written as favorite mode + favorite level; see [Rotation Speed and fan mode](#rotation-speed-and-fan-mode).
- **Status reads on legacy miIO** are split into `get_prop` requests of at most 15 property names, the same split python-miio uses for these purifiers because, as it notes, a request is limited to 16 properties. Each poll reads 18 names. The 2H from [#298](https://github.com/takenek/homebridge-xiaomi-air-purifier-modern/issues/298) answered them in a single request, so the split is a precaution for firmware that enforces the limit.

---

## Development

```bash
export NODE_OPTIONS="--unhandled-rejections=strict --trace-warnings --trace-uncaught --throw-deprecation --pending-deprecation --trace-deprecation"
npm ci
npm run lint
npm run typecheck
npm run typecheck:test
npm test
npm run build
```

### Running tests

```bash
npm test                  # run all tests
npx vitest --coverage     # run tests with coverage report
```

Tests enforce **100% coverage** (statements, branches, functions, lines) via vitest v5 + v8 provider. The test suite covers 9 automated scenarios for network resilience, device status synchronization, and filter lifecycle — see [`docs/reliability-test-plan.md`](./docs/reliability-test-plan.md) for details.

---

## AI Notice

This codebase was created entirely with the help of AI.

---

## License

MIT
