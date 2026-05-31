# midea-lan

Standalone JavaScript client for Midea's LAN protocol (V1/V2/V3) plus the
official MSmartHome / NetHome Plus / Midea Air cloud APIs. Lifted as-is
from the [ioBroker.midea](https://github.com/TA2k/ioBroker.midea)
adapter; no adapter dependencies remain — only `axios` and Node
built-ins.

## Capabilities

- Cloud login + token/key fetch (V1 NetHome Plus, V2 MSmartHome, multi-region routing).
- LAN discovery on UDP/6445 + UDP/20086 — broadcasts and unicast probes.
- V3 protocol: encrypted handshake, AES-CBC framing, retry-on-transient.
- V1 / V2 LAN protocol fallbacks.
- 35+ appliance types: AC, dehumidifier, fan, purifier, humidifier,
  refrigerator, washers/dryers, water heaters, heat pumps, dishwasher,
  microwave, oven, range hood, vacuum, smart toilet, water purifier,
  bathroom heater/light/fan, fresh air, gas boiler, electric heater.

## Install (in another project)

```bash
npm install /path/to/this/folder
# or copy this folder into your project and require by relative path
```

## Quick start

```js
const midea = require("midea-lan");

const cloud = midea.createCloudClient({
    user: process.env.MIDEA_USER,
    password: process.env.MIDEA_PASSWORD,
    appName: "msmart", // or "nethome", "mideaair"
});
await cloud.authenticate();

// Discover devices on the LAN
const found = await midea.discover({ logger: console });

for (const desc of found) {
    // Cloud token/key — only required for V3 devices
    const candidates = await midea.getTokenCandidatesWithFallback(cloud, desc.id);
    if (!candidates.length) continue;

    const dev = midea.createDevice({
        ...desc,
        token: candidates[0].token,
        key: candidates[0].key,
        logger: console,
    });

    await dev.refreshStatus();
    console.log(dev.status);
}
```

## Layout

```
lib/midea/
├─ index.js            entry point — exports every device class + helpers
├─ cloud.js            CloudClient (V2/MSmartHome) + CloudClientV1 (NetHome/MideaAir)
├─ lan.js              LanClient — V3 TCP control session, handshake, framing
├─ discover.js         UDP discovery (broadcast + unicast) for V1/V2/V3
├─ packet.js           low-level 0xAA frame builder
├─ parsers.js          shared frame decoders (C0, C1, B0/B1, A1, FA, ...)
├─ security.js         crypto: udpId, signing, AES-CBC/ECB, V3 auth
├─ logger.js           duck-typed logger wrapper (uses your console / pino / winston)
├─ devices/
│  ├─ base.js          BaseDevice — shared lifecycle + transport
│  ├─ ac.js            0xAC AC + new-protocol (B0/B1)
│  ├─ dehumidifier.js  0xA1
│  ├─ ...              one file per appliance type
└─ generated/          auto-generated mode/fan maps from cloud Lua plugins
   ├─ a1-maps.js
   ├─ ac-maps.js
   └─ fc-maps.js
```

## Re-generating maps from cloud Lua

The package ships four scripts that pull the Lua plugin Midea
serves per (deviceType, sn8) and emit the JSON tables under
`generated/`:

```bash
npm run fetch-lua -- --user … --password … --type 0xa1 --sn …
npm run extract-lua
npm run generate-maps
npm run diff-lua             # cross-check generated maps vs the device JS classes
# or all-in-one for extract + generate:
npm run sync-maps
```

The scripts take `--in` / `--out` flags to point them at custom
cache / output dirs; defaults are CWD-relative (`lua-cache/`,
`lua-tables/`, `generated/`).

## License

MIT — same as the parent ioBroker.midea project.
