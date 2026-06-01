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

```text
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
│  └─ ...              one file per appliance type
└─ scripts/            dev-only Cloud-Lua diff tooling (see below)
   ├─ fetch-protocol-lua.js
   ├─ extract-lua-tables.js
   ├─ generate-maps.js
   ├─ diff-lua-vs-js.js
   └─ generated/<hex>.json   committed snapshot per appliance type
```

The runtime is fully self-contained — every mode/fan/byte map is
hard-coded in the device classes. Cloud-Lua extraction is a
**development-only** workflow that lives entirely under `scripts/` next
to the lib; it is never imported at runtime.

## Cloud-Lua diff workflow (development only)

Midea's cloud serves a per-device protocol Lua plugin under
`/v2/luaEncryption/luaGet`. The lib ships scripts that fetch, decrypt
and parse those plugins so we can diff the values we hard-coded in the
device classes against whatever the cloud currently advertises:

```bash
cd lib/midea
npm run fetch-lua       # uses MIDEA_USER / MIDEA_PASSWORD env, walks the built-in
                        # SN catalog and writes lua-cache/T_0000_<HEX>_*.lua
npm run extract-lua     # parses lua-cache/*.lua → lua-tables/*.json
npm run generate-maps   # emits scripts/generated/<hex>.json as a snapshot of every
                        # constant we know about (modes, fans, KEY_/VALUE_/BYTE_,
                        # body offsets)
npm run diff-lua        # prints differences between the snapshot and the
                        # hand-coded constants in devices/*.js
npm run sync-maps       # extract + generate in one step
```

`scripts/generated/` is committed and **only reference material** for
diffing — no production code imports it. When the cloud publishes new
constants, the diff surfaces them so a maintainer can decide whether to
fold them into the device class. `lua-cache/` and `lua-tables/` are
gitignored intermediates.

## License

MIT — same as the parent ioBroker.midea project.
