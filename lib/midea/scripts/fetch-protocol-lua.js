#!/usr/bin/env node
 
"use strict";

/**
 * Fetch and decrypt the per-device protocol Lua plugin from the Midea
 * MSmartHome cloud. Mirrors msmart's BaseCloud.get_protocol_lua().
 *
 * Endpoint: POST /v2/luaEncryption/luaGet
 *   Body: { applianceMFCode: "0000",
 *           applianceSn: AES-128-CBC(sn, key=sha256(APP_KEY)[0:16], iv=sha256(APP_KEY)[16:32]).hex(),
 *           applianceType: "0xa1",
 *           encryptedType: 2,
 *           version: "0",
 *           ...standard cloud envelope }
 * Reply contains { fileName, url } where url returns hex-encoded
 * AES-CBC ciphertext under the same key/iv pair. After decryption it's
 * a UTF-8 Lua source file.
 *
 * Usage:
 *   node scripts/fetch-protocol-lua.js [--user USER] [--password PASS] [--out DIR]
 *                                      [--id DEVICE_ID]
 *                                      [--type 0xa1 --sn FULL_SERIAL]
 *                                      [--from-account]
 *
 * Default behaviour with no --id / --type / --sn / --from-account is to
 * walk the built-in DEFAULT_SN_CATALOG below — a curated list of (type,
 * serial) pairs that's known to return useful plugins. This is the path
 * a maintainer wants when seeding a fresh `lua-cache/` for diff work
 * without owning the hardware.
 *
 * --from-account uses the authenticated account's listAppliances() as
 * the source instead, optionally filtered by --id.
 *
 * --type+--sn queries an arbitrary single (type, sn) pair directly.
 *
 * Credentials default to env MIDEA_USER / MIDEA_PASSWORD.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const { CloudClient } = require("../cloud");
const sec = require("../security");

// Default lua-cache lives next to the lib so the package is self-contained.
const LIB_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(LIB_DIR, "lua-cache");

const APP_KEY = sec.DEFAULT_APP_KEY; // ac21b9f9cbfe4ca5a88562ef25e2b768

// Curated catalog of (applianceType, serial) pairs known to return a Lua
// plugin from /v2/luaEncryption/luaGet. Used when no explicit --id /
// --type / --sn / --from-account flag is given. Provenance: SNs surfaced
// from prior fetch runs, msmart fixtures and ioBroker GitHub issue logs.
// Each is ASCII-only and 32 chars. The cloud only cares about the
// 8-char "sn8" segment (offsets 9-16) for plugin lookup, so collisions
// across customers don't matter. If a row starts returning code=1318
// because Midea retired the plugin, drop or replace the entry.
const DEFAULT_SN_CATALOG = [
    { type: 0x1A, sn: "00001A311MSGWB0010C0411020279BWP" }, // smart toilet
    { type: 0x3D, sn: "00003D31163400130190321035063KPJ" }, // water dispenser
    { type: 0xAC, sn: "000000P0000000Q1B88C29C963BA0000" }, // residential AC (msmart fixture)
    { type: 0xAC, sn: "000000P0000000Q1F0C9D153F7B40000" }, // residential AC (msmart fixture, alt)
    { type: 0xBF, sn: "0000BF511700006AG41151400349ASW4" }, // microwave
    { type: 0xC3, sn: "0000C3310171000AUA3273100015GFRN" }, // heat-pump controller (171000AU)
    { type: 0xC3, sn: "0000C352017100003A6243100067SK54" }, // heat-pump controller (17100003)
    { type: 0xCC, sn: "0000CC341171PANEL6RT9HH32WA00000" }, // ambient panel
    { type: 0xCC, sn: "0000CC341171PNL0150L4HRSKLC20000" }, // ambient panel (alt)
    { type: 0xCD, sn: "0000CD311RSJRAC074715B100019Y57G" }, // heat-pump water heater
    { type: 0xD9, sn: "0000D951138209227A2096503395Z346" }, // sterilizer
    { type: 0xDB, sn: "0000DB51138124205A2155A00298VTX0" }, // washer
    { type: 0xDB, sn: "0000DB5133812912037035A00186J2WH" }, // washer (alt)
    { type: 0xE2, sn: "0000E2538510011422C091L00041WP22" }, // electric water heater
    { type: 0xE2, sn: "0000E254D5100077JA7073L00480UGY2" }, // electric water heater (alt)
    { type: 0xE3, sn: "0000E3531511018AT3B251400013GCH8" }, // gas water heater
    { type: 0xE3, sn: "0000E3511511018HWB4103800639193R" }, // gas water heater (alt)
    { type: 0xE3, sn: "0000E353151101906A9183401271J1RJ" }, // gas water heater (alt 2)
    { type: 0xED, sn: "0000ED511632009GCA6032T00162DPLU" }, // water purifier
    { type: 0xED, sn: "0000ED5116320098W41092Q00835Q91A" }, // water purifier (alt)
];

function aesAppKeyDeriveKeyAndIv() {
    const sha = crypto.createHash("sha256").update(APP_KEY).digest("hex");
    return { key: Buffer.from(sha.slice(0, 16), "utf8"), iv: Buffer.from(sha.slice(16, 32), "utf8") };
}

function aesAppKeyEncrypt(plaintext) {
    const { key, iv } = aesAppKeyDeriveKeyAndIv();
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesAppKeyDecrypt(ciphertext) {
    const { key, iv } = aesAppKeyDeriveKeyAndIv();
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function strftime() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function consoleLogger() {
    return {
        debug: (...a) => process.env.DEBUG && console.error("[debug]", ...a),
        info: (...a) => console.error("[info]", ...a),
        warn: (...a) => console.error("[warn]", ...a),
        error: (...a) => console.error("[error]", ...a),
        silly: () => {},
    };
}

async function fetchLuaForDevice(cloud, applianceType, sn) {
    // applianceType arrives as a number (0xA1) — endpoint wants "0xa1"
    const typeStr = `0x${Number(applianceType).toString(16).padStart(2, "0")}`;
    const snEnc = aesAppKeyEncrypt(Buffer.from(sn, "utf8")).toString("hex");

    const data = await cloud._apiRequest("/v2/luaEncryption/luaGet", {
        appId: "1010",
        src: "1010",
        format: 2,
        clientType: 1,
        language: "en_US",
        deviceId: cloud.deviceId,
        stamp: strftime(),
        reqId: crypto.randomBytes(16).toString("hex"),
        applianceMFCode: "0000",
        applianceSn: snEnc,
        applianceType: typeStr,
        // NOTE the trailing space — that's the actual contract msmart uses,
        // and the cloud server appears to be lenient about either form. We
        // mirror msmart verbatim to stay defensive against future tightening.
        "encryptedType ": 2,
        version: "0",
    });

    const fileName = data.data && data.data.fileName;
    const url = data.data && data.data.url;
    if (!fileName || !url) throw new Error(`luaGet: missing fileName/url in reply: ${JSON.stringify(data)}`);

    const res = await axios.get(url, { timeout: 15000, responseType: "text" });
    const ciphertext = Buffer.from(String(res.data).trim(), "hex");
    const lua = aesAppKeyDecrypt(ciphertext).toString("utf8");
    return { fileName, lua };
}

async function main() {
    const args = process.argv.slice(2);
    const opts = {
        user: process.env.MIDEA_USER, password: process.env.MIDEA_PASSWORD,
        out: DEFAULT_OUT, id: null, type: null, sn: null, fromAccount: false,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user") opts.user = args[++i];
        else if (args[i] === "--password") opts.password = args[++i];
        else if (args[i] === "--out") opts.out = args[++i];
        else if (args[i] === "--id") opts.id = args[++i];
        else if (args[i] === "--type") opts.type = args[++i];
        else if (args[i] === "--sn") opts.sn = args[++i];
        else if (args[i] === "--from-account") opts.fromAccount = true;
        else if (args[i] === "--help" || args[i] === "-h") {
            console.log("Usage: node scripts/fetch-protocol-lua.js [--user USER] [--password PASS] [--out DIR]");
            console.log("                                         [--from-account [--id DEVICE_ID]]");
            console.log("                                         [--type 0xa1 --sn FULLSERIAL]");
            console.log("Default with no flags walks the built-in DEFAULT_SN_CATALOG.");
            return;
        }
    }
    // --id implies pulling from the account
    if (opts.id) opts.fromAccount = true;
    if (!opts.user || !opts.password) {
        console.error("Missing credentials. Pass --user / --password or set MIDEA_USER / MIDEA_PASSWORD env vars.");
        process.exit(1);
    }

    fs.mkdirSync(opts.out, { recursive: true });

    const cloud = new CloudClient({
        user: opts.user,
        password: opts.password,
        logger: consoleLogger(),
    });
    await cloud.authenticate();

    // Manual probe mode: given an explicit type + sn, hit the endpoint directly
    // without touching listAppliances. Useful when the authenticated account
    // owns no devices but you still want to inspect what plugin the cloud
    // ships for an arbitrary hardware combination.
    if (opts.type && opts.sn) {
        const t = parseInt(String(opts.type).replace(/^0x/i, ""), 16);
        if (!Number.isFinite(t)) {
            console.error(`--type ${opts.type} is not a valid hex byte`);
            process.exit(2);
        }
        await fetchOne(cloud, opts.out, t, opts.sn, /*exitOnFail*/ true);
        return;
    }

    if (opts.fromAccount) {
        const list = await cloud.listAppliances();
        console.error(`[info] listAppliances -> ${list.length} appliance(s)`);
        let targets = list;
        if (opts.id) targets = list.filter((a) => String(a.id) === String(opts.id));
        if (!targets.length) {
            console.error(`No appliance matched id=${opts.id || "<all>"}`);
            process.exit(2);
        }
        for (const a of targets) {
            await fetchOne(cloud, opts.out, a.type, a.sn, /*exitOnFail*/ false);
        }
        return;
    }

    // Default path: walk the built-in catalog
    console.error(`[info] walking DEFAULT_SN_CATALOG (${DEFAULT_SN_CATALOG.length} entries)`);
    for (const { type, sn } of DEFAULT_SN_CATALOG) {
        await fetchOne(cloud, opts.out, type, sn, /*exitOnFail*/ false);
    }
}

async function fetchOne(cloud, outDir, applianceType, sn, exitOnFail) {
    const typeStr = `0x${Number(applianceType).toString(16)}`;
    console.error(`[info] fetching Lua for type=${typeStr} sn=${sn}`);
    try {
        const { fileName, lua } = await fetchLuaForDevice(cloud, applianceType, sn);
        const outPath = path.join(outDir, fileName);
        fs.writeFileSync(outPath, lua, "utf8");
        console.error(`[ok]   wrote ${outPath} (${lua.length} bytes)`);
    } catch (err) {
        const msg = (err && err.message) || String(err);
        // code=1318 = "没有最新lua文件上传" — Midea has no plugin for this
        // (type, sn) combo. Common for rare/old appliance types.
        if (/code=1318|没有最新lua/.test(msg)) {
            console.error(`[fail] no plugin available on the cloud for type=${typeStr} sn=${sn}`);
        } else {
            console.error(`[fail] type=${typeStr} sn=${sn}: ${msg}`);
        }
        if (exitOnFail) process.exit(2);
    }
}

main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
