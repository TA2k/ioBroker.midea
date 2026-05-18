"use strict";

const dgram = require("dgram");

const sec = require("./security");
const { makeLogger } = require("./logger");

const UDP_PORT = 6445;
const APPLIANCE_TYPES = {
    0xA1: "dehumidifier",
    0xAC: "ac",
    0xCC: "commercial_ac",
    0xFA: "fan",
    0xFC: "purifier",
    0xFD: "humidifier",
};

// Magic broadcast packet that triggers Midea devices to respond. Lifted
// verbatim from the official app and node-mideahvac.
const BROADCAST = Buffer.from([
    0x5a, 0x5a, 0x01, 0x11, 0x48, 0x00, 0x92, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x7f, 0x75, 0xbd, 0x6b, 0x3e, 0x4f, 0x8b, 0x76,
    0x2e, 0x84, 0x9c, 0x6e, 0x57, 0x8d, 0x65, 0x90,
    0x03, 0x6e, 0x9d, 0x43, 0x42, 0xa5, 0x0f, 0x1f,
    0x56, 0x9e, 0xb8, 0xec, 0x91, 0x8e, 0x92, 0xe5,
]);

function reverseHex(hex) {
    const out = [];
    for (let i = hex.length - 2; i >= 0; i -= 2) out.push(hex.substr(i, 2));
    return out.join("");
}

function trimNul(s) {
    let i = s.length;
    while (i > 0 && s.charCodeAt(i - 1) === 0) i--;
    return s.slice(0, i);
}

function parseDiscoveryReply(msg, sourceAddress) {
    let v3 = false;
    if (msg.length >= 8 && msg[0] === 0x83 && msg[1] === 0x70) {
        msg = msg.subarray(8, msg.length - 16);
        v3 = true;
    }
    if (msg[0] !== 0x5a || msg.length < 104) return null;

    const idHex = msg.subarray(20, 26).toString("hex");
    const id = BigInt("0x" + reverseHex(idHex)).toString();

    const data = sec.aesEcbDecryptNoPad(msg.subarray(40, msg.length - 16));

    const ssidLen = data[40];
    const macStart = 63 + ssidLen;
    const macParts = [];
    for (let i = 0; i < 6; i++) macParts.push(data[macStart + i].toString(16).padStart(2, "0"));

    const subTypeHex = data.subarray(57 + ssidLen, 59 + ssidLen).toString("hex");

    const appliance = {
        id,
        host: sourceAddress,
        port: parseInt(reverseHex(data.subarray(4, 8).toString("hex")), 16),
        sn: trimNul(data.subarray(8, 40).toString()),
        ssid: data.subarray(41, 41 + ssidLen).toString(),
        macAddress: macParts.join(":"),
        applianceType: data[55 + ssidLen],
        applianceTypeName: APPLIANCE_TYPES[data[55 + ssidLen]] || "unknown",
        applianceSubType: parseInt(reverseHex(subTypeHex), 16),
        firmwareVersion: `${data[72 + ssidLen]}.${data[73 + ssidLen]}.${data[74 + ssidLen]}`,
        v3,
    };
    if (v3) {
        appliance.udpId = sec.deriveUdpId(appliance.id);
    }
    return appliance;
}

/**
 * Broadcast on UDP/6445 and collect replying devices. Returns an array of
 * appliance descriptors. The function never throws on per-message decode
 * errors — they are logged and skipped, since misbehaving neighbours on
 * the same broadcast domain shouldn't break discovery.
 *
 * @param {object} [opts]
 * @param {string} [opts.target="255.255.255.255"]
 * @param {number} [opts.timeoutMs=5000]
 * @param {object} [opts.logger]
 */
function discover(opts = {}) {
    const log = makeLogger(opts.logger);
    const target = opts.target || "255.255.255.255";
    const timeoutMs = opts.timeoutMs || 5000;

    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        const found = new Map();

        log.debug(`discover: starting UDP broadcast target=${target} timeoutMs=${timeoutMs}`);

        socket.on("message", (msg, info) => {
            try {
                const dev = parseDiscoveryReply(msg, info.address);
                if (dev && !found.has(dev.id)) {
                    found.set(dev.id, dev);
                    log.debug(`discover: ${info.address} -> id=${dev.id} type=0x${dev.applianceType.toString(16)} (${dev.applianceTypeName}) v3=${dev.v3}`);
                }
            } catch (err) {
                log.warn(`discover: failed to parse reply from ${info.address} (${err.message})`);
            }
        });

        socket.on("error", (err) => {
            log.warn(`discover: socket error ${err.message}`);
            try { socket.close(); } catch (_e) { /* swallow */ }
            resolve(Array.from(found.values()));
        });

        const finish = () => {
            try { socket.close(); } catch (_e) { /* swallow */ }
            log.debug(`discover: finished, ${found.size} appliance(s)`);
            resolve(Array.from(found.values()));
        };

        socket.bind(0, () => {
            try {
                socket.setBroadcast(true);
            } catch (err) {
                log.warn(`discover: setBroadcast failed (${err.message})`);
            }
            socket.send(BROADCAST, 0, BROADCAST.length, UDP_PORT, target, (err) => {
                if (err) {
                    log.warn(`discover: broadcast send failed (${err.message})`);
                    finish();
                }
            });
            setTimeout(finish, timeoutMs);
        });
    });
}

module.exports = { discover, parseDiscoveryReply, APPLIANCE_TYPES, UDP_PORT };
