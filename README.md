![Logo](admin/midea.png)

# ioBroker.midea

[![NPM version](http://img.shields.io/npm/v/iobroker.midea.svg)](https://www.npmjs.com/package/iobroker.midea)
[![Downloads](https://img.shields.io/npm/dm/iobroker.midea.svg)](https://www.npmjs.com/package/iobroker.midea)
![Number of Installations (latest)](http://iobroker.live/badges/midea-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/midea-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.midea.png?downloads=true)](https://nodei.co/npm/iobroker.midea/)

ioBroker adapter for Midea, Dimstal and Royal Clima air conditioners. Talks the
**Midea V3 LAN protocol** directly to your appliance — the cloud account is only
contacted once per device to retrieve the encryption token/key pair. After that,
all status polls and commands run locally over the broadcast domain.

## How it works

1. UDP broadcast on port 6445 to discover all Midea V3 appliances on the LAN.
2. The adapter authenticates against the Midea overseas cloud
   (`mp-prod.appsmb.com`) once and asks for the per-device `{token, key}` pair
   needed for the LAN handshake.
3. From then on, control runs over TCP/6444 with the 8370 transport: AES-128-ECB
   for the inner command body, AES-256-CBC + HMAC-SHA-256 for the session
   transport, and CRC8 + MD5 checksum framing.

The cloud is only used for the initial token fetch and to list appliances that
the broadcast did not reach. There is no live data in the cloud path.

## Requirements

- Node.js **20** or newer.
- The ioBroker host must share an L2 broadcast domain with the appliance — UDP
  6445 must reach it. Across VLANs you need a UDP broadcast relay (e.g.
  `udpbroadcastrelay`).
- A **MSmartHome** account (the international Midea app, package
  `com.midea.ai.overseas`, available as *MSmartHome* on
  [Google Play](https://play.google.com/store/apps/details?id=com.midea.ai.overseas)
  and the iOS App Store). This is the only app variant the adapter speaks:
  cloud host `mp-prod.appsmb.com`, V3 sign protocol, MSmartHome appKey.

  Other Midea apps are **not** compatible — they use different hosts, app keys
  and signing schemes:

  | App | Package / Brand | Why not supported |
  | --- | --- | --- |
  | *Midea Air* | `com.midea.aircondition.obm` | legacy V1/V2 cloud (`mapp.appsmb.com`), different sign scheme |
  | *NetHome Plus* | legacy app | legacy V1/V2 cloud, different appKey |
  | *MSmartHome 美的美居* | China region | host `mp-prod.smartmidea.net`, currently hard-coded to overseas |
  | brand rebrands (e.g. *Comfee*, *Toshiba Home AC Control*) | various | usually MSmartHome-compatible, but with their own appKey — not auto-detected |

  If your devices were set up in *Midea Air* or *NetHome Plus*, install
  *MSmartHome* and re-bind them there.

## Configuration

| Field      | Description                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| `user`     | E-mail of your MSmartHome account.                                            |
| `password` | Password of your MSmartHome account.                                          |
| `interval` | Poll interval in seconds (5–3600, default 30). Each device is polled locally. |

## Object tree

```text
midea.0
├── info.connection                 — boolean: cloud reachable
└── devices.<deviceId>
    ├── info.*                      — id, name, host, mac, firmware, online…
    ├── capabilities.*              — flags reported by the appliance (B5)
    ├── status.*                    — current device state (read-only)
    └── controls.*                  — writeable commands
```

### Controls (residential AC, 0xAC)

| Control               | Type    | Description                                    |
| --------------------- | ------- | ---------------------------------------------- |
| `powerOn`             | boolean | Turn the unit on/off                           |
| `mode`                | enum    | auto / cool / dry / heat / fanonly / customdry |
| `temperatureSetpoint` | number  | 16–31 °C (60–87 °F)                            |
| `temperatureUnit`     | enum    | celsius / fahrenheit                           |
| `fanSpeed`            | number  | 0–102 (102 = auto)                             |
| `fanSpeedName`        | enum    | silent / low / medium / high / full / auto     |
| `swing`               | enum    | off / vertical / horizontal / both             |
| `ecoMode`             | boolean | Eco mode                                       |
| `turboMode`           | boolean | Turbo mode                                     |
| `sleepMode`           | boolean | Sleep mode                                     |
| `purify`              | boolean | Ionizer / purify                               |
| `dryClean`            | boolean | Internal dryer                                 |
| `frostProtection`     | boolean | 8 °C frost-protection heating                  |
| `toggleDisplay`       | button  | Toggle the indoor display LED                  |

The `status.*` tree exposes everything the device reports (indoor / outdoor
temperature, swing axes, error codes, timer state, total `powerUsage` in kWh, …).
The `capabilities.*` tree mirrors the B5 capability response so you can branch
your scripts on what the appliance actually supports.

### Controls (dehumidifier, 0xA1)

| Control            | Type    | Description                                  |
| ------------------ | ------- | -------------------------------------------- |
| `powerOn`          | boolean | Turn the unit on/off                         |
| `mode`             | enum    | setpoint / continuous / smart / dryer        |
| `targetHumidity`   | number  | 0–100 % target humidity                      |
| `fanSpeed`         | number  | 0–127 (40 silent, 60 low, 80 high, 102 auto) |
| `fanSpeedName`     | enum    | silent / low / medium / high / auto          |
| `ionMode`          | boolean | Ionizer / anion mode                         |
| `sleepMode`        | boolean | Sleep mode                                   |
| `pumpSwitch`       | boolean | Drain pump on/off                            |
| `verticalSwing`    | boolean | Vertical swing                               |
| `tankWarningLevel` | number  | Tank warning threshold (0–100 %)             |

The `status.*` tree exposes everything the device reports (indoor / outdoor
temperature, swing axes, error codes, timer state, total `powerUsage` in kWh, …).
The `capabilities.*` tree mirrors the B5 capability response so you can branch
your scripts on what the appliance actually supports.

## Supported appliance types

Coverage spans all 36 Midea V3 appliance types described in
[midea-local](https://github.com/midea-lan/midea-local).

Full control:

- `0xAC` residential AC, `0xCC` commercial AC, `0xA1` dehumidifier, `0xFA` fan,
  `0xFC` air purifier, `0xFD` humidifier.
- `0xCE` fresh-air, `0xCF` heat pump, `0xCD` heat-pump water heater,
  `0xC3` heat-pump controller (zones, DHW, silent/eco/disinfect).
- `0xDA` top-load washer, `0xDB` front-load washer, `0xDC` dryer.
- `0xE2` electric water heater, `0xE3` gas water heater, `0xE6` gas boiler,
  `0xFB` electric heater.
- `0xE1` dishwasher, `0xB0` microwave, `0xBF` integrated oven, `0xB6` range hood,
  `0xB8` vacuum, `0xC2` smart toilet, `0xED` water purifier.
- `0x13` light, `0x26` bathroom heater, `0x34` bathroom dishwasher,
  `0x40` bathroom fan.

Read-only metadata (no `MessageSet` defined upstream):

- `0xCA` refrigerator.
- `0xE8` pressure cooker, `0xEA`/`0xEC` rice cookers.
- `0xB1` oven, `0xB3` steamer, `0xB4` oven-steam combo.
- `0xAD` air-box (PM2.5 / VOC sensor).

For every controllable type, the writable fields are exposed under
`devices.<id>.controls.*`; sensor values land under `devices.<id>.status.*`.

### Controls (fan, 0xFA)

| Control            | Type    | Description                                             |
| ------------------ | ------- | ------------------------------------------------------- |
| `powerOn`          | boolean | Turn the unit on/off                                    |
| `childLock`        | boolean | Child lock                                              |
| `mode`             | enum    | normal / natural / sleep / comfort / silent / baby / …  |
| `fanSpeed`         | number  | 1–26                                                    |
| `oscillate`        | boolean | Oscillation on/off                                      |
| `oscillationMode`  | enum    | off / oscillation / tilting / curve-w / curve-8 / both  |
| `oscillationAngle` | enum    | off / 30 / 60 / 90 / 120 / 180 / 360                    |
| `tiltingAngle`     | enum    | off / 30 / 60 / 90 / 120 / 180 / 360 / +60 / -60 / 40   |

### Controls (air purifier, 0xFC)

| Control             | Type    | Description                                       |
| ------------------- | ------- | ------------------------------------------------- |
| `powerOn`           | boolean | Turn the unit on/off                              |
| `mode`              | enum    | standby / auto / manual / sleep / fast / smoke    |
| `fanSpeedName`      | enum    | auto / standby / low / medium / high              |
| `anion`             | boolean | Anion / ionizer                                   |
| `childLock`         | boolean | Child lock                                        |
| `screenDisplayName` | enum    | bright / dim / off                                |
| `detectMode`        | enum    | off / pm25 / methanal                             |
| `standby`           | boolean | Auto-standby on clean air                         |

The status tree exposes pm25, tvoc, hcho, filter1Life and filter2Life as
read-only sensor values.

### Controls (humidifier, 0xFD)

| Control             | Type    | Description                                                          |
| ------------------- | ------- | -------------------------------------------------------------------- |
| `powerOn`           | boolean | Turn the unit on/off                                                 |
| `mode`              | enum    | manual / auto / continuous / living-room / bed-room / kitchen / sleep |
| `targetHumidity`    | number  | 0–100 % target humidity                                              |
| `fanSpeedName`      | enum    | lowest / low / medium / high / auto / off                            |
| `screenDisplayName` | enum    | bright / dim / off                                                   |
| `disinfect`         | boolean | Disinfect cycle                                                      |

The status tree exposes currentHumidity, currentTemperature and tank as
read-only sensor values.

## Troubleshooting

- **`LAN discovery found 0 appliance(s)`** — your ioBroker host is not on the
  same broadcast domain as the appliance, or UDP 6445 is firewalled.
- **`Could not fetch token/key for …`** — the device is offline in the cloud
  account, or the credentials in the adapter config are wrong.
- **`LanClient: timeout`** — the AC is reachable on UDP but TCP/6444 is being
  blocked, or another LAN client (the phone app) is currently connected.
  Only one TCP control session is allowed at a time.

Switch the adapter to debug logging — every protocol step (cloud calls, UDP
discovery, TCP handshake, encrypted frames) is logged with payload sizes and
device ids so the implementation can be diagnosed from logs alone.

## Changelog

<!-- 
  Placeholder for next versions. Do NOT remove. 
-->

### 1.3.0

-   Coverage for all 36 Midea V3 appliance types described in
    [midea-local](https://github.com/midea-lan/midea-local).
-   Full control added for heat pumps (`0xCF`/`0xCD`/`0xC3`), washers and dryer
    (`0xDA`/`0xDB`/`0xDC`), water heaters (`0xE2`/`0xE3`), gas boiler (`0xE6`),
    electric heater (`0xFB`), dishwashers (`0xE1`/`0x34`), microwave (`0xB0`),
    integrated oven (`0xBF`), range hood (`0xB6`), vacuum (`0xB8`), smart toilet
    (`0xC2`), water purifier (`0xED`), bathroom light/heater/fan (`0x13`/`0x26`/
    `0x40`) and fresh-air (`0xCE`).
-   Read-only telemetry for refrigerator (`0xCA`), pressure/rice cookers
    (`0xE8`/`0xEA`/`0xEC`), oven/steamer (`0xB1`/`0xB3`/`0xB4`) and air-box
    (`0xAD`) — these types do not expose a `MessageSet` upstream.
-   Feature-parity pass against `midea-local`: standalone parser/setter for
    commercial AC (`0xCC`, replacing the residential AC reuse), new-protocol
    single-property setters (`body_type 0x14`) for `0xE2`/`0xE3` water heaters,
    full `0xC3` heat-pump telemetry (basic, energy, silence, eco, disinfect,
    unit parameters across body types `0x01`/`0x04`/`0x05`/`0x07`/`0x09`/
    `0x10`), `0xB6` range-hood `0x0A`/`0xA2` push notify (oilcup/cleaning),
    `0xA1` dehumidifier `childLock`, and additional `0xAC` C0 telemetry fields
    (kickQuilt, preventCold, comfortSleepSwitch, smartDry, swingLR, fresh-air
    filter timers).

### 1.2.0

-   Full control for fan (`0xFA`), air purifier (`0xFC`) and humidifier (`0xFD`).
-   Protocol byte layouts reverse-engineered from the
    [midea-local](https://github.com/midea-lan/midea-local) Home Assistant
    integration, no third-party runtime dependency added.

### 1.1.0

-   Full control for dehumidifier (`0xA1`) and commercial AC (`0xCC`).
-   Poll interval is now expressed in seconds (default 30 s) since the LAN
    transport keeps polling cheap.

### 1.0.0

-   Complete rewrite. Breaking change: states moved into a typed
    `devices.<id>.{info,status,capabilities,controls}` tree and the cloud
    transport is no longer used for runtime control.
-   LAN-first integration based on the Midea V3 protocol (UDP discovery,
    AES-128-ECB inner, AES-256-CBC outer, CRC8 + MD5 framing).
-   Self-contained protocol implementation — no third-party Midea library
    dependencies.
-   Capability detection (B5), live status (C0), power usage (C1), display
    toggle, full control surface for 0xAC residential ACs.

### 0.0.7

-   Last release of the legacy implementation.

## License

MIT License

Copyright (c) 2020-2026 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
