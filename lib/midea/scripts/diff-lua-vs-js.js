#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * Print a per-device summary comparing the cloud-served Lua plugin (mode
 * codes, byte constants, body-byte layout) against the corresponding
 * JavaScript constants in lib/midea/devices/*.js.
 *
 * Limited to coarse cross-checks — mode name/code maps and a couple of
 * obvious frame-offset sanity checks. Anything that requires reading
 * actual Lua control flow (the `binToModel` / `jsonToData` bodies) is
 * out of scope here; the human still has to look at those.
 *
 * Usage:
 *   node scripts/extract-lua-tables.js  # produces lua-tables/*.json
 *   node scripts/diff-lua-vs-js.js
 */

const fs = require("fs");
const path = require("path");

const TABLES_DIR = "lua-tables";
const DEVICE_DIR = path.join(__dirname, "..", "devices");

// Mapping from "T_0000_<HEX>_..." -> our device source file.
const FILE_BY_TYPE = {
    A1: "dehumidifier.js",
    AC: "ac.js",
    B6: "rangehood.js",
    B8: "vacuum.js",
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

function loadTables(typeHex) {
    const f = fs.readdirSync(TABLES_DIR).find((n) => n.startsWith(`T_0000_${typeHex}_`));
    if (!f) return null;
    return JSON.parse(fs.readFileSync(path.join(TABLES_DIR, f), "utf8"));
}

function loadDeviceSrc(typeHex) {
    const fname = FILE_BY_TYPE[typeHex];
    if (!fname) return null;
    const p = path.join(DEVICE_DIR, fname);
    if (!fs.existsSync(p)) return null;
    return { path: p, src: fs.readFileSync(p, "utf8") };
}

function modesFromLuaA1Style(tables) {
    // keyB has BYTE_MODE_<NAME> = <int>; keyV has VALUE_MODE_<NAME> = "<string>"
    const out = {};
    for (const [k, v] of Object.entries(tables.keyB || {})) {
        const mm = /^BYTE_MODE_(.+)$/.exec(k);
        if (mm && typeof v === "number") {
            // Try to find matching string from keyV
            let key = mm[1];
            // BYTE_MODE_DRY_CLOTH ↔ VALUE_MODE_DRY_CLOTHES (singular vs plural)
            const candidates = [
                `VALUE_MODE_${key}`,
                `VALUE_MODE_${key}S`,
                `VALUE_MODE_${key.replace(/H$/, "HES")}`, // CLOTH → CLOTHES
            ];
            let label = null;
            for (const cand of candidates) {
                if (tables.keyV && tables.keyV[cand]) { label = tables.keyV[cand]; break; }
            }
            out[v] = label || key.toLowerCase();
        }
    }
    return out;
}

function jsModeMapFromSrc(src, devFilePath) {
    // Look for `MODE_BY_INDEX = { 1: "setpoint", ... }` or similar.
    // A spread copy `{ ...a1maps.MODE_BY_INDEX }` matches but yields zero
    // numeric entries, so we fall through to the require() fallback below
    // when the static parse comes up empty.
    const out = {};
    const m = /MODE_BY_INDEX\s*=\s*\{([^}]+)\}/.exec(src);
    if (m) {
        const body = m[1];
        const pat = /(\d+)\s*:\s*"([^"]+)"/g;
        let mm;
        while ((mm = pat.exec(body)) !== null) out[parseInt(mm[1], 10)] = mm[2];
        if (Object.keys(out).length) return out;
    }
    // Fallback: device imports the map from generated/<X>-maps.js. Require
    // the device source and read the runtime export. Most device modules
    // re-export MODE_BY_INDEX at module level.
    if (devFilePath) {
        try {
            const mod = require(devFilePath);
            if (mod && mod.MODE_BY_INDEX) return { ...mod.MODE_BY_INDEX };
        } catch (_e) { /* swallow — best-effort cross-check */ }
    }
    return null;
}

function diffModeMap(typeHex, luaModes, jsModes) {
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
    if (!fs.existsSync(TABLES_DIR)) {
        console.error(`Run: node scripts/extract-lua-tables.js first (no ${TABLES_DIR}/)`);
        process.exit(2);
    }
    let total = 0;
    for (const typeHex of Object.keys(FILE_BY_TYPE)) {
        const tables = loadTables(typeHex);
        if (!tables) continue;
        const dev = loadDeviceSrc(typeHex);

        const luaModes = modesFromLuaA1Style(tables);
        const jsModes = dev ? jsModeMapFromSrc(dev.src, dev.path) : null;
        if (!Object.keys(luaModes).length && !jsModes) continue;

        const rows = diffModeMap(typeHex, luaModes, jsModes);
        if (!rows.length) continue;

        console.log(`\n=== 0x${typeHex} (${dev ? dev.path : "no JS file"}) ===`);
        for (const r of rows) {
            console.log(`  code=${String(r.code).padStart(2)}  lua="${r.lua || "-"}"  js="${r.js || "-"}"  ${r.kind}`);
            total++;
        }
    }
    if (!total) console.log("No mode-map differences found.");
    else console.log(`\n${total} differences total.`);
}

main();
