#!/usr/bin/env node
/* eslint-disable no-console */
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
 *
 * Without --id and without --type/--sn every appliance from
 * listAppliances() is fetched. With --type+--sn an arbitrary
 * appliance-type / serial pair is queried directly (useful when the
 * authenticated account is empty but you want to probe what plugin the
 * cloud serves for a given hardware type).
 * Credentials default to env MIDEA_USER / MIDEA_PASSWORD.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const { CloudClient } = require("../lib/midea/cloud");
const sec = require("../lib/midea/security");

const APP_KEY = sec.DEFAULT_APP_KEY; // ac21b9f9cbfe4ca5a88562ef25e2b768

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
        encryptedType: 2,
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
        out: "lua-cache", id: null, type: null, sn: null,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user") opts.user = args[++i];
        else if (args[i] === "--password") opts.password = args[++i];
        else if (args[i] === "--out") opts.out = args[++i];
        else if (args[i] === "--id") opts.id = args[++i];
        else if (args[i] === "--type") opts.type = args[++i];
        else if (args[i] === "--sn") opts.sn = args[++i];
        else if (args[i] === "--help" || args[i] === "-h") {
            console.log("Usage: node scripts/fetch-protocol-lua.js [--user USER] [--password PASS] [--out DIR] [--id DEVICE_ID]");
            console.log("       node scripts/fetch-protocol-lua.js --type 0xa1 --sn FULLSERIAL");
            return;
        }
    }
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
        console.error(`[info] probing Lua for type=0x${t.toString(16)} sn=${opts.sn}`);
        const { fileName, lua } = await fetchLuaForDevice(cloud, t, opts.sn);
        const outPath = path.join(opts.out, fileName);
        fs.writeFileSync(outPath, lua, "utf8");
        console.error(`[ok]   wrote ${outPath} (${lua.length} bytes)`);
        return;
    }

    const list = await cloud.listAppliances();
    console.error(`[info] listAppliances -> ${list.length} appliance(s)`);

    let targets = list;
    if (opts.id) targets = list.filter((a) => String(a.id) === String(opts.id));
    if (!targets.length) {
        console.error(`No appliance matched id=${opts.id}`);
        process.exit(2);
    }

    for (const a of targets) {
        console.error(`[info] fetching Lua for id=${a.id} type=0x${Number(a.type).toString(16)} sn=${a.sn}`);
        try {
            const { fileName, lua } = await fetchLuaForDevice(cloud, a.type, a.sn);
            const outPath = path.join(opts.out, fileName);
            fs.writeFileSync(outPath, lua, "utf8");
            console.error(`[ok]   wrote ${outPath} (${lua.length} bytes)`);
        } catch (err) {
            console.error(`[fail] id=${a.id}: ${err && err.message ? err.message : err}`);
        }
    }
}

main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
