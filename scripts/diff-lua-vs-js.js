#!/usr/bin/env node

"use strict";

/**
 * Cross-check the Cloud-Lua snapshot in scripts/generated/<hex>.json
 * against the hand-coded JavaScript constants in lib/midea/devices/*.js.
 *
 * Two pieces of output:
 *
 *   1. Per-device mode-map diff: for every device class we know how to
 *      pull MODE_BY_INDEX from, list any code -> name pair where the
 *      cloud snapshot and the JS source disagree.
 *   2. Reference-only summary: number of keys/values/bytes the cloud
 *      plugin exposes. Informational — most plugins describe many more
 *      things than the adapter actually exposes (DRM-protected GUI
 *      strings, packaging metadata, etc.).
 *
 * Anything that requires reading actual Lua control flow (binToModel /
 * jsonToData bodies) is out of scope here; the human still has to look
 * at those.
 *
 * Usage:
 *   node scripts/extract-lua-tables.js
 *   node scripts/generate-maps.js
 *   node scripts/diff-lua-vs-js.js
 *   # or:
 *   npm run sync-maps && npm run diff-lua
 */

const fs = require("fs");
const path = require("path");

const GENERATED_DIR = path.join(__dirname, "generated");
const DEVICE_DIR = path.join(__dirname, "..", "lib", "midea", "devices");

// Mapping from "<HEX>" -> our device source file.
const FILE_BY_TYPE = {
    A1: "dehumidifier.js",
    AC: "ac.js",
    B6: "rangehood.js",
    B8: "vacuum.js",
    C3: "heatpumpctrl.js",
    CA: "refrigerator.js",
    CD: "heatpumpwater.js",
    DB: "laundry.js",
    E1: "dishwasher.js",
    E2: "electricwaterheater.js",
    E3: "gaswaterheater.js",
    E6: "gasboiler.js",
    ED: "waterpurifier.js",
    FC: "purifier.js",
};

function loadSnapshot(typeHex) {
    const p = path.join(GENERATED_DIR, `${typeHex.toLowerCase()}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadDeviceSrc(typeHex) {
    const fname = FILE_BY_TYPE[typeHex];
    if (!fname) return null;
    const p = path.join(DEVICE_DIR, fname);
    if (!fs.existsSync(p)) return null;
    return { path: p, src: fs.readFileSync(p, "utf8") };
}

function jsModeMapFromSrc(src, devFilePath) {
    // Look for `MODE_BY_INDEX = { 1: "setpoint", ... }` or similar.
    const out = {};
    const m = /MODE_BY_INDEX\s*=\s*\{([^}]+)\}/.exec(src);
    if (m) {
        const body = m[1];
        const pat = /(\d+)\s*:\s*"([^"]+)"/g;
        let mm;
        while ((mm = pat.exec(body)) !== null) out[parseInt(mm[1], 10)] = mm[2];
        if (Object.keys(out).length) return out;
    }
    // Fallback: the device module re-exports MODE_BY_INDEX. Require it.
    if (devFilePath) {
        try {
            const mod = require(devFilePath);
            if (mod && mod.MODE_BY_INDEX) return { ...mod.MODE_BY_INDEX };
        } catch (_e) { /* swallow — best-effort cross-check */ }
    }
    return null;
}

function diffModeMap(luaModes, jsModes) {
    const allKeys = new Set([...Object.keys(luaModes || {}), ...Object.keys(jsModes || {})]);
    const rows = [];
    for (const k of [...allKeys].sort((a, b) => +a - +b)) {
        const lua = luaModes ? luaModes[k] : null;
        const js = jsModes ? jsModes[k] : null;
        if (lua === js) continue;
        let kind;
        if (lua && !js) kind = "MISSING_IN_JS";
        else if (!lua && js) kind = "MISSING_IN_LUA";
        else kind = "NAME_MISMATCH";
        rows.push({ code: +k, lua, js, kind });
    }
    return rows;
}

function main() {
    if (!fs.existsSync(GENERATED_DIR)) {
        console.error(`No snapshots in ${GENERATED_DIR}. Run: npm run sync-maps`);
        process.exit(2);
    }
    let modeDiffs = 0;
    const summaryRows = [];
    for (const typeHex of Object.keys(FILE_BY_TYPE)) {
        const snap = loadSnapshot(typeHex);
        if (!snap) continue;
        const dev = loadDeviceSrc(typeHex);

        const luaModes = snap.modes || {};
        const jsModes = dev ? jsModeMapFromSrc(dev.src, dev.path) : null;

        const rows = diffModeMap(luaModes, jsModes || {});
        if (Object.keys(luaModes).length || (jsModes && Object.keys(jsModes).length)) {
            if (rows.length) {
                console.log(`\n=== 0x${typeHex} (${dev ? dev.path : "no JS file"}) ===`);
                for (const r of rows) {
                    console.log(`  code=${String(r.code).padStart(2)}  lua="${r.lua || "-"}"  js="${r.js || "-"}"  ${r.kind}`);
                    modeDiffs++;
                }
            }
        }

        summaryRows.push({
            type: `0x${typeHex.toLowerCase()}`,
            modes: Object.keys(luaModes).length,
            fans: Object.keys(snap.fans || {}).length,
            keys: Object.keys(snap.keys || {}).length,
            values: Object.keys(snap.values || {}).length,
            bytes: Object.keys(snap.bytes || {}).length,
            strings: Object.keys(snap.strings || {}).length,
            bodyOffsets: Object.keys(snap.bodyOffsets || {}).length,
        });
    }

    console.log(`\n--- Plugin coverage (cloud snapshot side) ---`);
    console.log("type   modes fans keys vals byts strs body");
    for (const r of summaryRows) {
        console.log(
            `${r.type}   ` +
            String(r.modes).padStart(5) + " " +
            String(r.fans).padStart(4) + " " +
            String(r.keys).padStart(4) + " " +
            String(r.values).padStart(4) + " " +
            String(r.bytes).padStart(4) + " " +
            String(r.strings).padStart(4) + " " +
            String(r.bodyOffsets).padStart(4)
        );
    }

    if (!modeDiffs) console.log("\nNo mode-map differences found.");
    else console.log(`\n${modeDiffs} mode-map differences total.`);
}

main();
