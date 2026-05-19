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
- A Midea overseas cloud account (the same email/password you use in the
  *Midea Air* / *NetHome Plus* phone app). Region-specific apps (e.g. Chinese
  *MSmartHome*) are **not** supported.

## Configuration

| Field      | Description                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| `user`     | Midea overseas account e-mail.                                                |
| `password` | Midea overseas account password.                                              |
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

Full control: residential air conditioner (`0xAC`), commercial air conditioner
(`0xCC`, same UART layout as `0xAC`), dehumidifier (`0xA1`).
Metadata only (discovered, but no controls): `0xFA` fan, `0xFC` purifier,
`0xFD` humidifier. PRs welcome.

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
