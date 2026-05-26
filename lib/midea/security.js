"use strict";

const crypto = require("node:crypto");

const SIGN_KEY = "xhdiwjnchekd4d512chdjx5d8e4c394D2D7S";
const SIGN_KEY_BUF = Buffer.from(SIGN_KEY, "ascii");
const SIGN_KEY_MD5 = crypto.createHash("md5").update(SIGN_KEY_BUF).digest();

const HMAC_SIGN_KEY = "PROD_VnoClJI9aikS8dyy";
const DEFAULT_APP_KEY = "ac21b9f9cbfe4ca5a88562ef25e2b768";

const MSGTYPE_HANDSHAKE_REQUEST = 0x00;
const MSGTYPE_HANDSHAKE_RESPONSE = 0x01;
const MSGTYPE_ENCRYPTED_RESPONSE = 0x03;
const MSGTYPE_ENCRYPTED_REQUEST = 0x06;

function md5(buf) {
    return crypto.createHash("md5").update(buf).digest();
}

function sha256(buf) {
    return crypto.createHash("sha256").update(buf).digest();
}

function aesEcbEncrypt(data) {
    const cipher = crypto.createCipheriv("aes-128-ecb", SIGN_KEY_MD5, null);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesEcbDecrypt(data) {
    const decipher = crypto.createDecipheriv("aes-128-ecb", SIGN_KEY_MD5, null);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

// Discovery replies are 16-byte aligned and not PKCS#7 padded — the device
// sends raw block data. Decrypting with auto-padding would treat trailing
// bytes as a length prefix and either strip data or throw "bad decrypt".
function aesEcbDecryptNoPad(data) {
    const decipher = crypto.createDecipheriv("aes-128-ecb", SIGN_KEY_MD5, null);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

function aesCbcEncrypt(data, key) {
    const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.alloc(16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesCbcDecrypt(data, key) {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.alloc(16));
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptIamPassword(appKey, loginId, password) {
    const pwd1 = crypto.createHash("md5").update(password).digest("hex");
    const pwd2 = crypto.createHash("md5").update(pwd1).digest("hex");
    return crypto.createHash("sha256").update(loginId + pwd2 + appKey).digest("hex");
}

function encryptPassword(appKey, loginId, password) {
    const pwdHash = crypto.createHash("sha256").update(password).digest("hex");
    return crypto.createHash("sha256").update(loginId + pwdHash + appKey).digest("hex");
}

function signCloudPayload(payload, random) {
    return crypto.createHmac("sha256", HMAC_SIGN_KEY).update(`meicloud${payload}${random}`).digest("hex");
}

/**
 * V1 cloud signature (NetHome Plus / Midea Air / Ariston Clima).
 * sha256(urlPath + sortedFormDataDecoded + appKey)
 *
 * Matches midea-local's `unquote_plus(urlencode(sorted(...)))`: the form is
 * built sorted by key, then percent-decoded so the signature input contains
 * raw characters (e.g. `@` stays `@`, space stays space). Encoding it
 * differently — leaving `%40` for `@` — produces a mismatched signature and
 * the cloud rejects every email-based login.
 *
 * @param {string} urlPath e.g. "/v1/user/login"
 * @param {Record<string, string|number>} data form fields
 * @param {string} appKey login key for the chosen V1 app
 * @returns {string} hex digest
 */
function signMideaAir(urlPath, data, appKey) {
    const params = new URLSearchParams();
    for (const k of Object.keys(data).sort()) {
        params.append(k, String(data[k]));
    }
    const payload = decodeURIComponent(params.toString().replace(/\+/g, " "));
    return crypto.createHash("sha256").update(urlPath + payload + appKey).digest("hex");
}

/**
 * Build the V2/V3 message header (0x5A5A) that wraps the AES-128-ECB
 * encrypted command payload.
 *
 * @param {Buffer} encryptedPayload AES-128-ECB(MD5(SIGN_KEY)) encrypted body
 * @param {number} messageId rolling counter, 1..0x7FFF
 * @param {string|Buffer|number} deviceId 12-hex device id
 * @returns {Buffer}
 */
function addHeader0x5A5A(encryptedPayload, messageId, deviceId) {
    const header = Buffer.alloc(40);
    header[0] = 0x5a;
    header[1] = 0x5a;
    header[2] = 0x01;
    header[3] = 0x11;
    header[6] = 0x20;

    const packet = Buffer.concat([header, encryptedPayload]);
    const totalLen = packet.length + 16;
    packet.writeUInt16LE(totalLen & 0xffff, 4);

    // msmart-ng / midea-local leave bytes [8..11] as zero. Some firmware revisions
    // appear to silently drop encrypted command bodies whose 5A5A messageId is
    // non-zero, even though the 0x8370 handshake is accepted. The `messageId`
    // arg is kept for callers but intentionally not written.
    void messageId;

    const now = new Date();
    packet[12] = now.getMilliseconds() & 0xff;
    packet[13] = now.getSeconds();
    packet[14] = now.getMinutes();
    packet[15] = now.getHours();
    packet[16] = now.getDate();
    packet[17] = now.getMonth() + 1;
    packet[18] = now.getFullYear() % 100;
    packet[19] = Math.floor(now.getFullYear() / 100);

    let idHex;
    if (Buffer.isBuffer(deviceId)) {
        idHex = deviceId.toString("hex");
    } else if (typeof deviceId === "number") {
        idHex = BigInt(deviceId).toString(16);
    } else {
        idHex = String(deviceId);
        if (/^\d+$/.test(idHex)) {
            idHex = BigInt(idHex).toString(16);
        }
    }
    if (idHex.length % 2 === 1) idHex = "0" + idHex;
    let idBuf = Buffer.from(idHex, "hex");
    if (idBuf.length < 6) {
        idBuf = Buffer.concat([Buffer.alloc(6 - idBuf.length), idBuf]);
    } else if (idBuf.length > 6) {
        idBuf = idBuf.subarray(idBuf.length - 6);
    }
    for (let i = 0; i < 6; i++) {
        packet[20 + i] = idBuf[5 - i];
    }

    return packet;
}

/**
 * Append the MD5 checksum used by V2/V3 LAN packets.
 * checksum = MD5(packet || SIGN_KEY)[16]
 */
function appendMd5Checksum(packet) {
    const digest = crypto.createHash("md5").update(Buffer.concat([packet, SIGN_KEY_BUF])).digest();
    return Buffer.concat([packet, digest]);
}

/**
 * Encode a payload according to the V3 8370 outer protocol.
 * Used to wrap handshake (token) and encrypted command frames before
 * sending them over the TCP transport on port 6444.
 *
 * @param {Buffer} data inner payload (cleartext or token)
 * @param {number} msgType MSGTYPE_HANDSHAKE_REQUEST / MSGTYPE_ENCRYPTED_REQUEST
 * @param {number} requestCount running counter, advanced by caller
 * @param {Buffer|null} tcpKey 32-byte session key (only required for ENCRYPTED_REQUEST)
 * @returns {Buffer}
 */
function encode0x8370(data, msgType, requestCount, tcpKey) {
    let padding = 0;
    let size = data.length;

    if (msgType === MSGTYPE_ENCRYPTED_REQUEST) {
        if ((size + 2) % 16 !== 0) {
            padding = 16 - ((size + 2) & 0x0f);
            size += padding + 32;
            data = Buffer.concat([data, Buffer.alloc(padding)]);
        } else {
            size += 32;
        }
    }

    const header = Buffer.from([
        0x83, 0x70,
        (size & 0xff00) >> 8, size & 0x00ff,
        0x20,
        ((padding & 0x0f) << 4) | (msgType & 0x0f),
    ]);

    const counter = Buffer.from([(requestCount & 0xff00) >> 8, requestCount & 0x00ff]);
    let body = Buffer.concat([counter, data]);

    if (msgType === MSGTYPE_ENCRYPTED_REQUEST) {
        if (!tcpKey) throw new Error("encode0x8370: tcpKey required for encrypted request");
        const sign = sha256(Buffer.concat([header, body]));
        body = aesCbcEncrypt(body, tcpKey);
        body = Buffer.concat([body, sign]);
    }

    return Buffer.concat([header, body]);
}

/**
 * Decode a single 8370 frame received from the TCP transport.
 * Returns { msgType, payload, leftover }.
 * `leftover` contains any bytes following this frame in the buffer (rare,
 * but handled in case the kernel coalesces multiple frames).
 *
 * @param {Buffer} data full frame starting at 0x83 0x70
 * @param {Buffer|null} tcpKey
 */
function decode0x8370(data, tcpKey) {
    if (data.length < 6) throw new Error("decode0x8370: frame too short");
    if (data[0] !== 0x83 || data[1] !== 0x70) {
        throw new Error(`decode0x8370: invalid magic ${data[0].toString(16)}${data[1].toString(16)}`);
    }
    if (data[4] !== 0x20) {
        throw new Error(`decode0x8370: unexpected byte 4 ${data[4].toString(16)}`);
    }

    const declared = data.readUInt16BE(2) + 8;
    let leftover = Buffer.alloc(0);
    if (data.length > declared) {
        leftover = Buffer.from(data.subarray(declared));
        data = data.subarray(0, declared);
    } else if (data.length < declared) {
        throw new Error(`decode0x8370: short frame (have ${data.length}, want ${declared})`);
    }

    const padding = data[5] >> 4;
    const msgType = data[5] & 0x0f;
    const header = data.subarray(0, 6);
    let body = data.subarray(6);

    if (msgType === MSGTYPE_ENCRYPTED_RESPONSE) {
        if (!tcpKey) throw new Error("decode0x8370: tcpKey required for encrypted response");
        if (body.length < 32) throw new Error(`decode0x8370: encrypted body too short (${body.length})`);
        const sign = body.subarray(body.length - 32);
        body = body.subarray(0, body.length - 32);
        body = aesCbcDecrypt(body, tcpKey);
        const calculated = sha256(Buffer.concat([header, body]));
        if (!calculated.equals(sign)) {
            throw new Error("decode0x8370: signature mismatch");
        }
        if (padding) body = body.subarray(0, body.length - padding);
    }

    const responseCount = body.readUInt16BE(0);
    const payload = body.subarray(2);

    return { msgType, responseCount, payload, leftover };
}

/**
 * Derive the per-session AES-256 key from the 64-byte authenticate response.
 *
 * @param {Buffer} response the 8-byte-stripped authenticate body
 * @param {Buffer} key the 32-byte device key from the cloud
 * @returns {Buffer} 32-byte tcpKey
 */
function deriveTcpKey(response, key) {
    if (response.length !== 64) {
        throw new Error(`deriveTcpKey: expected 64-byte response, got ${response.length}`);
    }
    const payload = response.subarray(0, 32);
    const sign = response.subarray(32);
    const decrypted = aesCbcDecrypt(payload, key);
    const calculated = sha256(decrypted);
    if (!calculated.equals(sign)) {
        throw new Error("deriveTcpKey: signature mismatch");
    }
    const tcpKey = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) tcpKey[i] = decrypted[i] ^ key[i];
    return tcpKey;
}

/**
 * Methods for serialising the device id before hashing into the udpId,
 * matching midea-local's UdpIdMethod enum.
 */
const UDP_ID_METHODS = Object.freeze({
    REVERSED_BIG: 0, // 8-byte big-endian then byte-reversed (== 8-byte little-endian)
    BIG: 1, // 6-byte big-endian
    LITTLE: 2, // 6-byte little-endian
});

/**
 * Coerce a device id (number/bigint/decimal-string/hex-string/Buffer) into a
 * BigInt. Numeric strings are parsed as decimal; Buffers as big-endian.
 *
 * @param {string|Buffer|number|bigint} deviceId
 * @returns {bigint}
 */
function _deviceIdToBigInt(deviceId) {
    if (typeof deviceId === "bigint") return deviceId;
    if (typeof deviceId === "number") return BigInt(deviceId);
    if (Buffer.isBuffer(deviceId)) {
        let v = 0n;
        for (const b of deviceId) v = (v << 8n) | BigInt(b);
        return v;
    }
    const s = String(deviceId);
    if (/^\d+$/.test(s)) return BigInt(s);
    if (/^0?x?[0-9a-fA-F]+$/.test(s)) return BigInt("0x" + s.replace(/^0x/i, ""));
    throw new Error(`deriveUdpId: unparseable deviceId "${s}"`);
}

/**
 * Compute the udpId used by the cloud when retrieving the per-device
 * token/key pair: serialise the device id according to `method`, SHA256 it,
 * then XOR the two 16-byte halves.
 *
 * Default `method` is REVERSED_BIG (8-byte little-endian) to preserve
 * historical behaviour for LAN-side callers. The cloud `getToken` endpoint
 * actually expects either BIG (6-byte big-endian) or LITTLE (6-byte
 * little-endian); cloud.js iterates over both.
 *
 * @param {string|Buffer|number|bigint} deviceId
 * @param {number} [method] one of UDP_ID_METHODS
 * @returns {string} 32-char hex
 */
function deriveUdpId(deviceId, method = UDP_ID_METHODS.REVERSED_BIG) {
    const id = _deviceIdToBigInt(deviceId);
    let bytes;
    if (method === UDP_ID_METHODS.REVERSED_BIG) {
        const big8 = Buffer.alloc(8);
        big8.writeBigUInt64BE(id, 0);
        bytes = Buffer.from(big8).reverse();
    } else if (method === UDP_ID_METHODS.BIG) {
        bytes = Buffer.alloc(6);
        let v = id;
        for (let i = 5; i >= 0; i--) {
            bytes[i] = Number(v & 0xffn);
            v >>= 8n;
        }
    } else if (method === UDP_ID_METHODS.LITTLE) {
        bytes = Buffer.alloc(6);
        let v = id;
        for (let i = 0; i < 6; i++) {
            bytes[i] = Number(v & 0xffn);
            v >>= 8n;
        }
    } else {
        throw new Error(`deriveUdpId: unknown method ${method}`);
    }
    const digest = sha256(bytes);
    const out = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) out[i] = digest[i] ^ digest[i + 16];
    return out.toString("hex");
}

module.exports = {
    SIGN_KEY,
    SIGN_KEY_BUF,
    SIGN_KEY_MD5,
    HMAC_SIGN_KEY,
    DEFAULT_APP_KEY,
    MSGTYPE_HANDSHAKE_REQUEST,
    MSGTYPE_HANDSHAKE_RESPONSE,
    MSGTYPE_ENCRYPTED_RESPONSE,
    MSGTYPE_ENCRYPTED_REQUEST,
    md5,
    sha256,
    aesEcbEncrypt,
    aesEcbDecrypt,
    aesEcbDecryptNoPad,
    aesCbcEncrypt,
    aesCbcDecrypt,
    encryptIamPassword,
    encryptPassword,
    signCloudPayload,
    signMideaAir,
    addHeader0x5A5A,
    appendMd5Checksum,
    encode0x8370,
    decode0x8370,
    deriveTcpKey,
    deriveUdpId,
    UDP_ID_METHODS,
};
