#!/usr/bin/env node
 
"use strict";

/**
 * Parse Midea cloud-served Lua plugins and extract the lookup tables that
 * govern frame encoding/decoding. Output is a JSON file per type that
 * lists keyT (state-key aliases), keyV (state-value strings), keyB (byte
 * constants), and a guess of the body-byte layout from the binToModel /
 * jsonToData functions.
 *
 * Lua syntax we care about (everything else is ignored):
 *
 *   keyT["KEY_FOO"] = "foo"
 *   keyV["VALUE_BAR"] = "bar"
 *   keyB["BYTE_BAZ"] = 0x42
 *
 * keyT/keyV/keyB are the conventional table names every plugin uses. The
 * scraper is forgiving: it tolerates whitespace, integer or string RHS,
 * decimal or hex literals, and quote style differences.
 *
 * Usage:
 *   node scripts/extract-lua-tables.js [--in lua-cache] [--out lua-tables]
 */

const fs = require("fs");
const path = require("path");

const KEY_TABLES = ["keyT", "keyV", "keyB", "uptable", "locals", "strings"];

function parseTablesFromLua(src) {
    const out = {
        keyT: {}, keyV: {}, keyB: {}, // legacy A1/AC convention
        uptable: {},                  // CA/E1/FC convention
        locals: {},                   // B6/CD/DB style: bare `local FOO = "bar"`
        strings: {},                  // any  ["state_name"] = "value" (e.g. B6/CD)
        body_offsets: {},
    };

    // 1) keyed tables: keyT["FOO"] = "bar" / 0x42 / nil
    const tableNamePat = /\b(keyT|keyV|keyB|uptable)\s*\[\s*"([^"]+)"\s*\]\s*=\s*("([^"]*)"|nil|0x[0-9A-Fa-f]+|-?\d+)/g;
    let m;
    while ((m = tableNamePat.exec(src)) !== null) {
        const tbl = m[1], name = m[2], rhs = m[3];
        if (rhs === "nil") continue;
        let value;
        if (m[4] !== undefined) value = m[4];
        else if (rhs.startsWith("0x") || rhs.startsWith("-0x")) value = parseInt(rhs, 16);
        else value = parseInt(rhs, 10);
        out[tbl][name] = value;
    }

    // 2) bare locals — `local NAME = "string"` or `local NAME = 0x42`
    //    Common in B6/DB/CD style plugins where every constant is a local.
    const localPat = /\blocal\s+([A-Z_][A-Z0-9_]+)\s*=\s*("([^"]*)"|0x[0-9A-Fa-f]+|-?\d+)\b/g;
    while ((m = localPat.exec(src)) !== null) {
        const name = m[1], rhs = m[2];
        let value;
        if (m[3] !== undefined) value = m[3];
        else if (rhs.startsWith("0x") || rhs.startsWith("-0x")) value = parseInt(rhs, 16);
        else value = parseInt(rhs, 10);
        out.locals[name] = value;
    }

    // 3) string-keyed values — `["status"] = "running"` (typically inside
    //    streams[...]= ... assignments). We capture all such pairs which
    //    helps map device-specific status fields → human-readable strings.
    const stringPat = /\[\s*"([a-z_][a-z0-9_]*)"\s*\]\s*=\s*"([^"]+)"/g;
    while ((m = stringPat.exec(src)) !== null) {
        const k = m[1], v = m[2];
        if (!out.strings[k]) out.strings[k] = new Set();
        out.strings[k].add(v);
    }
    // serialize Set → array
    for (const k of Object.keys(out.strings)) out.strings[k] = [...out.strings[k]];

    // 4) Body offsets from binToModel: lines like
    //    keyP["windSpeedValue"] = bit.band(messageBytes[3], 0x7F)
    //    self.fan_speed = body[3] & 0x7F  (in some uptable plugins via
    //    `streams["fan_speed"] = messageBytes[3]`)
    const offsetPats = [
        /keyP\["([^"]+)"\]\s*=\s*(?:bit\.band\(\s*)?messageBytes\[(\d+)\](?:\s*,\s*(0x[0-9A-Fa-f]+|\d+))?/g,
        /streams\["([^"]+)"\]\s*=\s*(?:bit\.band\(\s*)?messageBytes\[(\d+)\](?:\s*,\s*(0x[0-9A-Fa-f]+|\d+))?/g,
    ];
    for (const p of offsetPats) {
        while ((m = p.exec(src)) !== null) {
            const field = m[1], offset = parseInt(m[2], 10);
            const mask = m[3] ? (m[3].startsWith("0x") ? parseInt(m[3], 16) : parseInt(m[3], 10)) : null;
            if (!out.body_offsets[field]) out.body_offsets[field] = [];
            out.body_offsets[field].push({ offset, mask });
        }
    }

    return out;
}

function main() {
    const args = process.argv.slice(2);
    const LIB_DIR = path.resolve(__dirname, "..");
    let inDir = path.join(LIB_DIR, "lua-cache");
    let outDir = path.join(LIB_DIR, "lua-tables");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--in") inDir = args[++i];
        else if (args[i] === "--out") outDir = args[++i];
        else if (args[i] === "--help" || args[i] === "-h") {
            console.log("Usage: node scripts/extract-lua-tables.js [--in lua-cache] [--out lua-tables]");
            return;
        }
    }
    if (!fs.existsSync(inDir)) { console.error(`input dir not found: ${inDir}`); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });

    const summary = [];
    for (const f of fs.readdirSync(inDir).sort()) {
        if (!f.endsWith(".lua")) continue;
        const src = fs.readFileSync(path.join(inDir, f), "utf8");
        const tables = parseTablesFromLua(src);
        const baseName = f.replace(/\.lua$/, ".json");
        const outPath = path.join(outDir, baseName);
        fs.writeFileSync(outPath, JSON.stringify(tables, null, 2), "utf8");
        const counts = KEY_TABLES.map((k) => `${k}=${Object.keys(tables[k]).length}`).join(" ");
        const offCount = Object.keys(tables.body_offsets).length;
        summary.push(`${f}  ->  ${baseName}   [${counts} body_offsets=${offCount}]`);
    }
    console.log(summary.join("\n"));
}

main();
