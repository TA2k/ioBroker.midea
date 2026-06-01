#!/usr/bin/env node

"use strict";

/**
 * Parse Midea cloud-served Lua plugins via a real Lua AST (luaparse) and
 * extract every constant table plus the higher-level structural facts
 * we can derive from the parsed code: the property surface, accepted
 * value-strings per property, byte-encoding patterns and body-byte
 * offsets.
 *
 * Output is one JSON file per input plugin under lua-tables/, with the
 * shape consumed by generate-maps.js / diff-lua-vs-js.js.
 *
 * Buckets (numbers are AC plugin examples):
 *   keyT        keyT["KEY_FOO"] = "foo"                   (82)
 *   keyV        keyV["VALUE_BAR"] = "bar"                 (14)
 *   keyB        keyB["BYTE_BAZ"] = 0x42                   (64)
 *   uptable     uptable["FOO"] = ...   (CA/E1/FC style)
 *   locals      bare `local FOO = "x"`                    (B6/CD/DB)
 *   strings     ["foo"] = "bar"  (any string-keyed pair)  (29)
 *   exposedKeys distinct keys in streams[keyT["KEY_*"]] = ...
 *               -> the JSON property surface the plugin emits          (51)
 *   acceptedValues for each KEY_*, the set of value strings the plugin
 *               assigns to streams[keyT["KEY_*"]] (drained via VALUE_*) (~80)
 *   encodeBytes BYTE_* constants written into the outgoing frame
 *               buffer in jsonToData -- {byte_const: [offsets...]}     (varies)
 *   body_offsets binToModel decode offsets:
 *               streams[...] = messageBytes[N], optionally bit.band'ed (29)
 *
 * Empty buckets are emitted as empty objects. luaparse is a real
 * grammar parser so it tolerates the minified one-line plugins Midea
 * actually serves.
 *
 * Usage:
 *   node scripts/extract-lua-tables.js [--in lua-cache] [--out lua-tables]
 */

const fs = require("fs");
const path = require("path");
const luaparse = require("luaparse");

const KEY_TABLES_FOR_SUMMARY = [
    "keyT", "keyV", "keyB", "uptable", "locals", "strings",
    "exposedKeys", "acceptedValues", "encodeBytes", "body_offsets",
];

function literalNumber(node) {
    if (!node) return null;
    if (node.type === "NumericLiteral") return node.value;
    if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") {
        return -node.argument.value;
    }
    return null;
}

function literalString(node) {
    if (!node || node.type !== "StringLiteral") return null;
    return node.value;
}

// Walk `node` recursively, calling visitor(child) on every descendant.
function walk(node, visitor) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, visitor); return; }
    if (typeof node.type === "string") visitor(node);
    for (const k of Object.keys(node)) {
        if (k === "type" || k === "raw" || k === "loc" || k === "range") continue;
        walk(node[k], visitor);
    }
}

// Match `streams[ keyT["KEY_FOO"] ] = <rhs>` and `streams["foo"] = <rhs>`.
// Returns { keyName, rhs } or null.
function matchStreamsAssignment(node) {
    if (node.type !== "AssignmentStatement") return null;
    if (node.variables.length !== 1 || node.init.length !== 1) return null;
    const lhs = node.variables[0];
    if (lhs.type !== "IndexExpression") return null;
    if (!lhs.base || lhs.base.type !== "Identifier" || lhs.base.name !== "streams") return null;
    let keyName, keyKind;
    if (lhs.index.type === "IndexExpression"
        && lhs.index.base.type === "Identifier"
        && lhs.index.base.name === "keyT"
        && lhs.index.index.type === "StringLiteral") {
        keyName = lhs.index.index.value;
        keyKind = "keyT";
    } else if (lhs.index.type === "StringLiteral") {
        keyName = lhs.index.value;
        keyKind = "string";
    } else {
        return null;
    }
    return { keyName, keyKind, rhs: node.init[0] };
}

// Resolve `keyV["VALUE_FOO"]` -> "foo" if known.
function resolveKeyValueRef(rhs, keyV) {
    if (!rhs) return null;
    if (rhs.type === "StringLiteral") return rhs.value;
    if (rhs.type === "IndexExpression"
        && rhs.base.type === "Identifier"
        && rhs.base.name === "keyV"
        && rhs.index.type === "StringLiteral") {
        const k = rhs.index.value;
        if (Object.prototype.hasOwnProperty.call(keyV, k)) return keyV[k];
        return `keyV[${k}]`;
    }
    if (rhs.type === "NumericLiteral") return rhs.value;
    if (rhs.type === "Identifier") return `<${rhs.name}>`;
    return null;
}

// Match `bit.band(messageBytes[N], MASK)` or `messageBytes[N]`.
// Returns { offset, mask } or null.
function matchMessageBytes(node) {
    if (!node) return null;
    if (node.type === "IndexExpression"
        && node.base.type === "Identifier"
        && node.base.name === "messageBytes"
        && node.index.type === "NumericLiteral") {
        return { offset: node.index.value, mask: null };
    }
    if (node.type === "CallExpression"
        && node.base.type === "MemberExpression"
        && node.base.base.type === "Identifier"
        && node.base.base.name === "bit"
        && node.base.identifier.type === "Identifier"
        && node.base.identifier.name === "band"
        && node.arguments.length >= 2) {
        const inner = node.arguments[0];
        if (inner.type === "IndexExpression"
            && inner.base.type === "Identifier"
            && inner.base.name === "messageBytes"
            && inner.index.type === "NumericLiteral") {
            const mask = literalNumber(node.arguments[1]);
            return { offset: inner.index.value, mask };
        }
    }
    return null;
}

function parseTablesFromLua(src) {
    const out = {
        keyT: {}, keyV: {}, keyB: {},
        uptable: {},
        locals: {},
        strings: {},                  // ["foo"] = "bar" outside streams[]
        exposedKeys: {},              // distinct streams[keyT[KEY]] writes
        acceptedValues: {},           // KEY_FOO -> [string,...] (set)
        encodeBytes: {},              // BYTE_FOO -> [out-frame offsets seen with]
        body_offsets: {},             // keyT-name or string -> [{offset,mask}, ...]
    };

    let ast;
    let lastErr;
    // Try encoding modes from strict to lax. "x-user-defined" preserves
    // every byte literally (best for keyT/keyV string values), but a few
    // plugins contain raw multi-byte codepoints that the strict reader
    // rejects; "none" tolerates them at the cost of nulled string values
    // we don't actually use. "pseudo-latin1" is the next fallback.
    for (const mode of ["x-user-defined", "none", "pseudo-latin1"]) {
        try {
            ast = luaparse.parse(src, { encodingMode: mode, luaVersion: "5.1" });
            break;
        } catch (err) {
            lastErr = err;
        }
    }
    if (!ast) {
        throw new Error(`luaparse failed: ${lastErr ? lastErr.message : "unknown"}`);
    }

    // 1) Walk all assignments to populate the keyed tables (keyT/keyV/keyB
    //    /uptable) and bare-local constants. Driven off the AST so we don't
    //    have to special-case formatting.
    walk(ast, (node) => {
        if (node.type === "AssignmentStatement") {
            for (let i = 0; i < node.variables.length; i++) {
                const lhs = node.variables[i];
                const rhs = node.init[i];
                if (!lhs || !rhs) continue;
                if (lhs.type !== "IndexExpression") continue;
                if (lhs.base.type !== "Identifier") continue;
                const tbl = lhs.base.name;
                if (!["keyT", "keyV", "keyB", "uptable"].includes(tbl)) continue;
                if (lhs.index.type !== "StringLiteral") continue;
                const name = lhs.index.value;
                if (rhs.type === "NilExpression") continue;
                let value = literalString(rhs);
                if (value === null) value = literalNumber(rhs);
                if (value === null) continue;
                out[tbl][name] = value;
            }
        } else if (node.type === "LocalStatement") {
            for (let i = 0; i < node.variables.length; i++) {
                const v = node.variables[i];
                const init = node.init[i];
                if (!v || !init) continue;
                if (!/^[A-Z_][A-Z0-9_]+$/.test(v.name)) continue;
                let value = literalString(init);
                if (value === null) value = literalNumber(init);
                if (value === null) continue;
                out.locals[v.name] = value;
            }
        }
    });

    // 2) String-keyed pairs anywhere in the AST — `["foo"] = "bar"` (table
    //    literals or assignments). Excludes the streams[] writes which
    //    have their own bucket.
    const seenStrings = {};
    walk(ast, (node) => {
        if (node.type === "TableKeyString" || node.type === "TableKey") {
            const k = node.type === "TableKeyString"
                ? node.key.name
                : (node.key.type === "StringLiteral" ? node.key.value : null);
            if (!k || !/^[a-z_][a-z0-9_]*$/.test(k)) return;
            const v = literalString(node.value);
            if (v === null) return;
            if (!seenStrings[k]) seenStrings[k] = new Set();
            seenStrings[k].add(v);
        } else if (node.type === "AssignmentStatement") {
            for (let i = 0; i < node.variables.length; i++) {
                const lhs = node.variables[i], rhs = node.init[i];
                if (!lhs || !rhs) continue;
                if (lhs.type !== "IndexExpression" || lhs.index.type !== "StringLiteral") continue;
                if (lhs.base.type === "Identifier" && lhs.base.name === "streams") continue; // skip — handled separately
                const k = lhs.index.value;
                if (!/^[a-z_][a-z0-9_]*$/.test(k)) continue;
                const v = literalString(rhs);
                if (v === null) continue;
                if (!seenStrings[k]) seenStrings[k] = new Set();
                seenStrings[k].add(v);
            }
        }
    });
    for (const k of Object.keys(seenStrings)) out.strings[k] = [...seenStrings[k]].sort();

    // 3) streams[ keyT["KEY_*"] ] = <value>  AND streams["string"] = <value>
    //    — the JSON property surface the plugin emits, plus the set of
    //    value-strings each property can take. Also handles binToModel
    //    offsets when rhs is messageBytes[N] / bit.band(messageBytes[N], MASK).
    //    For the keyT-flavour the bucket key is the upper-case KEY_*; for
    //    the string-flavour we keep the raw lower-case property name.
    const accepted = {};
    walk(ast, (node) => {
        const m = matchStreamsAssignment(node);
        if (!m) return;
        const key = m.keyName;
        if (m.keyKind === "keyT") out.exposedKeys[key] = true;
        else if (m.keyKind === "string") out.exposedKeys[key] = true;
        // Collect accepted values.
        const value = resolveKeyValueRef(m.rhs, out.keyV);
        if (value !== null && value !== undefined && typeof value !== "object") {
            if (!accepted[key]) accepted[key] = new Set();
            accepted[key].add(value);
        }
        // Detect body offsets.
        const off = matchMessageBytes(m.rhs);
        if (off) {
            if (!out.body_offsets[key]) out.body_offsets[key] = [];
            out.body_offsets[key].push(off);
        }
    });
    for (const k of Object.keys(accepted)) {
        out.acceptedValues[k] = [...accepted[k]].sort();
    }

    // 3b) keyP["fieldName"] = bit.band(messageBytes[N], MASK) is the dominant
    //     binToModel decode pattern in the legacy A1/AC plugins. Pull these
    //     into body_offsets too — keyed by the human field name (matches
    //     what diff-lua-vs-js.js already understands).
    walk(ast, (node) => {
        if (node.type !== "AssignmentStatement") return;
        for (let i = 0; i < node.variables.length; i++) {
            const lhs = node.variables[i];
            const rhs = node.init[i];
            if (!lhs || !rhs) continue;
            if (lhs.type !== "IndexExpression") continue;
            if (lhs.base.type !== "Identifier" || lhs.base.name !== "keyP") continue;
            if (lhs.index.type !== "StringLiteral") continue;
            const key = lhs.index.value;
            const off = matchMessageBytes(rhs);
            if (!off) continue;
            if (!out.body_offsets[key]) out.body_offsets[key] = [];
            out.body_offsets[key].push(off);
        }
    });

    // 4) BYTE_* constants used inside `bit.bor(...)` arguments of out-frame
    //    builders — gives us an idea which BYTE_FOO actually contributes
    //    to the encoded set frame. The bucket is keyed by BYTE_NAME with
    //    the count of occurrences, since the same BYTE_FOO can appear in
    //    multiple OR'd compositions.
    walk(ast, (node) => {
        if (node.type === "CallExpression"
            && node.base.type === "MemberExpression"
            && node.base.base.type === "Identifier"
            && node.base.base.name === "bit"
            && node.base.identifier.type === "Identifier"
            && (node.base.identifier.name === "bor" || node.base.identifier.name === "band")) {
            for (const arg of node.arguments) {
                if (arg.type === "IndexExpression"
                    && arg.base.type === "Identifier"
                    && arg.base.name === "keyB"
                    && arg.index.type === "StringLiteral") {
                    const name = arg.index.value;
                    out.encodeBytes[name] = (out.encodeBytes[name] || 0) + 1;
                }
            }
        }
    });

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
        let tables;
        try {
            tables = parseTablesFromLua(src);
        } catch (err) {
            summary.push(`${f}  ->  PARSE FAILED: ${err.message}`);
            continue;
        }
        const baseName = f.replace(/\.lua$/, ".json");
        const outPath = path.join(outDir, baseName);
        fs.writeFileSync(outPath, JSON.stringify(tables, null, 2), "utf8");
        const counts = KEY_TABLES_FOR_SUMMARY.map((k) => `${k}=${Object.keys(tables[k] || {}).length}`).join(" ");
        summary.push(`${f}  ->  ${baseName}   [${counts}]`);
    }
    console.log(summary.join("\n"));
}

main();
