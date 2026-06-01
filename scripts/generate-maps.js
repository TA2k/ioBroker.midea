#!/usr/bin/env node

"use strict";

/**
 * Generate a flat JSON snapshot per device type that captures every
 * lookup constant the cloud-served Lua plugin defines — mode codes, fan
 * speeds, KEY_/VALUE_/BYTE_ tables, bare-locals, string-keyed values
 * and the body-byte offsets. Reads lua-tables/*.json (produced by
 * scripts/extract-lua-tables.js) and writes one file per device type
 * under scripts/generated/.
 *
 * The output is **diff-material only** — nothing in lib/midea/ imports
 * it. Hand-coded device classes are the source of truth at runtime; this
 * snapshot exists so a maintainer can run `npm run sync-maps` after a
 * cloud refresh and see, via `npm run diff-lua`, exactly which constants
 * Midea added, renamed or removed since the last fetch.
 *
 * Naming convention:  T_0000_<HEX>_<VER>.json  ->  generated/<lower-hex>.json
 *
 * The shape of each generated file:
 *   {
 *     source: "T_0000_AC_24.lua",
 *     applianceType: "0xac",
 *     modes:        { "1": "auto", "2": "cool", ... },     -- pre-shifted bytes un-shifted
 *     fans:         { "20": "silent", ... },               -- AC only
 *     keys:         { KEY_FAN_SPEED: "wind_speed", ... },  -- attribute name aliases
 *     values:       { VALUE_MODE_AUTO: "auto", ... },      -- value strings
 *     bytes:        { BYTE_BUZZER_ON: 64, ... },           -- frame-set byte constants
 *     locals:       { ... },                               -- bare-local style plugins
 *     strings:      { mode: ["heat","cool",...], ... },    -- ["foo"]="bar" pairs
 *     bodyOffsets:  { wind_speed: [{offset:3, mask:127}], ... }
 *   }
 *
 * Empty buckets are still emitted as {} so the diff tool can rely on
 * the shape regardless of plugin style.
 *
 * Usage:
 *   node scripts/generate-maps.js [--in lua-tables] [--out scripts/generated]
 */

const fs = require("fs");
const path = require("path");

// Plugin convention per type — which table holds the BYTE_MODE_*/VALUE_MODE_*
// constants, and whether the byte values are pre-shifted in the frame.
const TYPE_CONFIG = {
    A1: { table: "keyB", valueTable: "keyV", shiftBits: 0 },
    AC: { table: "keyB", valueTable: "keyV", shiftBits: 5 }, // mode = byte 2 >> 5
    FC: { table: "uptable", valueTable: "uptable", shiftBits: 4 }, // mode = byte ? >> 4
};

function buildModeMap(tables, cfg) {
    const out = {};
    if (!cfg) return out;
    const codes = tables[cfg.table] || {};
    const labels = tables[cfg.valueTable] || {};
    for (const [k, v] of Object.entries(codes)) {
        const mm = /^BYTE_MODE_(.+)$/.exec(k);
        if (!mm || typeof v !== "number") continue;
        const tail = mm[1];
        const candidates = [
            `VALUE_MODE_${tail}`,
            `VALUE_MODE_${tail}S`,
            `VALUE_MODE_${tail.replace(/H$/, "HES")}`, // CLOTH → CLOTHES
        ];
        let label = null;
        for (const c of candidates) if (typeof labels[c] === "string") { label = labels[c]; break; }
        if (!label) label = tail.toLowerCase();
        const code = cfg.shiftBits ? v >> cfg.shiftBits : v;
        out[code] = label;
    }
    return out;
}

function buildFanMap(tables, cfg) {
    const out = {};
    if (!cfg) return out;
    const codes = tables[cfg.table] || {};
    const labels = tables[cfg.valueTable] || {};
    for (const [k, v] of Object.entries(codes)) {
        const mm = /^BYTE_FAN(?:SPEED)?_(.+)$/.exec(k);
        if (!mm || typeof v !== "number") continue;
        const tail = mm[1];
        const candidates = [
            `VALUE_FANSPEED_${tail}`,
            `VALUE_FAN_SPEED_${tail}`,
            `VALUE_FAN_${tail}`,
        ];
        let label = null;
        for (const c of candidates) if (typeof labels[c] === "string") { label = labels[c]; break; }
        if (!label) label = tail.toLowerCase();
        out[v] = label;
    }
    return out;
}

// Extract every KEY_/VALUE_/BYTE_ entry across both legacy keyT/keyV/keyB
// and the modern uptable convention. Plugins use one OR the other; we
// merge so the generated file always has a uniform shape.
function partitionConstants(tables) {
    const keys = {}, values = {}, bytes = {};
    const sources = [tables.keyT, tables.keyV, tables.keyB, tables.uptable, tables.locals];
    for (const src of sources) {
        if (!src) continue;
        for (const [k, v] of Object.entries(src)) {
            if (/^KEY_/.test(k)) keys[k] = v;
            else if (/^VALUE_/.test(k)) values[k] = v;
            else if (/^BYTE_/.test(k)) bytes[k] = v;
        }
    }
    return { keys, values, bytes };
}

function sortObject(obj) {
    return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
function sortNumeric(obj) {
    return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => Number(a) - Number(b)));
}

function main() {
    const args = process.argv.slice(2);
    let inDir = "lua-tables", outDir = path.join("scripts", "generated");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--in") inDir = args[++i];
        else if (args[i] === "--out") outDir = args[++i];
        else if (args[i] === "--help" || args[i] === "-h") {
            console.log("Usage: node scripts/generate-maps.js [--in lua-tables] [--out scripts/generated]");
            return;
        }
    }
    if (!fs.existsSync(inDir)) { console.error(`input dir not found: ${inDir}`); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });

    const lines = [];
    for (const f of fs.readdirSync(inDir).sort()) {
        if (!f.endsWith(".json")) continue;
        const m = /^T_0000_([0-9A-F]{2})_/.exec(f);
        if (!m) continue;
        const typeHex = m[1];
        const cfg = TYPE_CONFIG[typeHex];
        const tables = JSON.parse(fs.readFileSync(path.join(inDir, f), "utf8"));

        const modes = buildModeMap(tables, cfg);
        const fans = buildFanMap(tables, cfg);
        const { keys, values, bytes } = partitionConstants(tables);

        const out = {
            source: f.replace(/\.json$/, ".lua"),
            applianceType: `0x${typeHex.toLowerCase()}`,
            modes: sortNumeric(modes),
            fans: sortNumeric(fans),
            keys: sortObject(keys),
            values: sortObject(values),
            bytes: sortObject(bytes),
            locals: sortObject(tables.locals || {}),
            strings: sortObject(tables.strings || {}),
            bodyOffsets: sortObject(tables.body_offsets || {}),
        };

        const outName = `${typeHex.toLowerCase()}.json`;
        const outPath = path.join(outDir, outName);
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
        const sumCount =
            Object.keys(out.modes).length +
            Object.keys(out.fans).length +
            Object.keys(out.keys).length +
            Object.keys(out.values).length +
            Object.keys(out.bytes).length +
            Object.keys(out.locals).length +
            Object.keys(out.strings).length +
            Object.keys(out.bodyOffsets).length;
        lines.push(`${f}: -> ${outPath}  (modes=${Object.keys(out.modes).length}, fans=${Object.keys(out.fans).length}, keys=${Object.keys(out.keys).length}, values=${Object.keys(out.values).length}, bytes=${Object.keys(out.bytes).length}, locals=${Object.keys(out.locals).length}, strings=${Object.keys(out.strings).length}, bodyOffsets=${Object.keys(out.bodyOffsets).length}, total=${sumCount})`);
    }
    console.log(lines.join("\n"));
}

main();
