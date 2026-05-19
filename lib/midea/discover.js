"use strict";

const dgram = require("dgram");
const net = require("net");
const os = require("os");

const sec = require("./security");
const { makeLogger } = require("./logger");

const UDP_PORT = 6445;
const UDP_PORT_ALT = 20086; // midea-local sends to 6445 + 20086 in parallel
const V1_DEVICE_INFO_TIMEOUT_MS = 5000;
/**
 * Compute the IPv4 broadcast address for a CIDR, e.g. 192.168.1.42/24 -> 192.168.1.255.
 * Returns null when the input isn't a usable IPv4 unicast.
 */
function computeBroadcast(addr, cidrPrefix) {
    if (!addr || cidrPrefix === undefined || cidrPrefix < 0 || cidrPrefix > 32) return null;
    const parts = addr.split(".").map((s) => Number(s));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return null;
    const a = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    if (cidrPrefix === 32) return null;
    const mask = cidrPrefix === 0 ? 0 : (~0 << (32 - cidrPrefix)) >>> 0;
    const bcast = (a | (~mask >>> 0)) >>> 0;
    return [(bcast >>> 24) & 0xff, (bcast >>> 16) & 0xff, (bcast >>> 8) & 0xff, bcast & 0xff].join(".");
}

/**
 * Enumerate all IPv4 unicast/private/non-loopback interfaces and return their
 * directed broadcast addresses. Mirrors midea-local's
 * `enum_all_broadcast` helper. Falls back to ["255.255.255.255"] when no
 * usable interface is found.
 */
function enumerateBroadcastTargets() {
    const ifaces = os.networkInterfaces();
    const targets = new Set();
    for (const list of Object.values(ifaces)) {
        if (!list) continue;
        for (const iface of list) {
            if (iface.family !== "IPv4" || iface.internal) continue;
            // CIDR may be missing on some platforms; skip those.
            if (!iface.cidr) continue;
            const slash = iface.cidr.indexOf("/");
            if (slash < 0) continue;
            const prefix = Number(iface.cidr.slice(slash + 1));
            const bcast = computeBroadcast(iface.address, prefix);
            if (bcast && bcast !== "255.255.255.255") targets.add(bcast);
        }
    }
    if (targets.size === 0) targets.add("255.255.255.255");
    return Array.from(targets);
}

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

// V1 follow-up packet, sent over TCP after the XML broadcast reply, to learn
// the appliance's deviceId. Lifted verbatim from midea-local discover.py.
const V1_DEVICE_INFO_MSG = Buffer.from([
    0x5a, 0x5a, 0x15, 0x00, 0x00, 0x38, 0x00, 0x04,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x27, 0x33, 0x05,
    0x13, 0x06, 0x14, 0x14, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x03, 0xe8, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xca, 0x8d, 0x9b, 0xf9, 0xa0, 0x30, 0x1a, 0xe3,
    0xb7, 0xe4, 0x2d, 0x53, 0x49, 0x47, 0x62, 0xbe,
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

function parseV2OrV3(msg, sourceAddress, protocol) {
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
        protocol,
        v3: protocol === 3,
    };
    if (protocol === 3) {
        appliance.udpId = sec.deriveUdpId(appliance.id);
    }
    return appliance;
}

function parseDiscoveryReply(msg, sourceAddress) {
    if (msg.length >= 8 && msg[0] === 0x83 && msg[1] === 0x70) {
        const inner = msg.subarray(8, msg.length - 16);
        return parseV2OrV3(inner, sourceAddress, 3);
    }
    if (msg.length >= 2 && msg[0] === 0x5a && msg[1] === 0x5a) {
        return parseV2OrV3(msg, sourceAddress, 2);
    }
    return null;
}

function attrFromXml(xml, tag, attr) {
    // Lightweight: regex over a single device/smartDevice element. The XML
    // payload is fully controlled by the appliance (tens of bytes, fixed
    // schema) so a one-shot regex is fine here.
    const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, "i");
    const m = re.exec(xml);
    return m ? m[1] : null;
}

function getV1DeviceInfo(host, port, log) {
    return new Promise((resolve) => {
        let buf = Buffer.alloc(0);
        let done = false;
        const sock = net.createConnection(port, host);
        const finish = (result) => {
            if (done) return;
            done = true;
            try { sock.destroy(); } catch (_e) { /* swallow */ }
            resolve(result);
        };
        const timer = setTimeout(() => {
            log.debug(`discover[v1]: getDeviceInfo timeout ${host}:${port}`);
            finish(null);
        }, V1_DEVICE_INFO_TIMEOUT_MS);
        sock.once("connect", () => sock.write(V1_DEVICE_INFO_MSG));
        sock.on("data", (chunk) => {
            const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            buf = Buffer.concat([buf, chunkBuf]);
            // 5a5a frame: total length at bytes [4:6] LE.
            if (buf.length >= 6 && buf[0] === 0x5a && buf[1] === 0x5a) {
                const declared = buf.readUInt16LE(4);
                if (declared >= 64 && declared <= 4096 && buf.length >= declared) {
                    clearTimeout(timer);
                    finish(buf.subarray(0, declared));
                }
            }
        });
        sock.on("error", (err) => {
            log.debug(`discover[v1]: getDeviceInfo socket error ${host}:${port} (${err.message})`);
            clearTimeout(timer);
            finish(null);
        });
        sock.on("close", () => {
            clearTimeout(timer);
            finish(null);
        });
    });
}

function parseV1Reply(msg, sourceAddress, log) {
    const xml = msg.toString("utf8");
    const portStr = attrFromXml(xml, "device", "port");
    const apcSn = attrFromXml(xml, "device", "apc_sn");
    const apcTypeStr = attrFromXml(xml, "device", "apc_type");
    if (!portStr || !apcTypeStr) {
        log.debug(`discover[v1]: missing attrs in XML from ${sourceAddress}`);
        return null;
    }
    const port = parseInt(portStr, 10);
    const applianceType = parseInt(apcTypeStr, 10);
    if (!Number.isFinite(port) || !Number.isFinite(applianceType)) return null;

    let model = "";
    if (apcSn) {
        if (apcSn.length === 32) model = apcSn.slice(9, 17);
        else if (apcSn.length === 22) model = apcSn.slice(3, 11);
    }

    return {
        host: sourceAddress,
        port,
        sn: apcSn || "",
        model,
        applianceType,
        applianceTypeName: APPLIANCE_TYPES[applianceType] || "unknown",
        protocol: 1,
        v3: false,
    };
}

async function enrichV1WithDeviceId(partial, log) {
    const response = await getV1DeviceInfo(partial.host, partial.port, log);
    if (!response) return null;
    // The response carries an inner XML payload at bytes [64 : -16] containing
    // <smartDevice devId="…"/> with devId in little-endian hex.
    if (response.length < 80) return null;
    const inner = response.subarray(64, response.length - 16).toString("utf8");
    if (!inner.startsWith("<?xml ")) return null;
    const devIdHex = attrFromXml(inner, "smartDevice", "devId");
    if (!devIdHex || devIdHex.length === 0 || devIdHex.length % 2 !== 0) {
        log.debug(`discover[v1]: smartDevice@devId missing/malformed in ${partial.host} response`);
        return null;
    }
    const id = BigInt("0x" + reverseHex(devIdHex)).toString();
    return Object.assign(partial, { id });
}

/**
 * Broadcast on UDP/6445 + UDP/20086 across every IPv4 interface and collect
 * replying devices. Returns an array of appliance descriptors. The function
 * never throws on per-message decode errors — they are logged and skipped,
 * since misbehaving neighbours on the same broadcast domain shouldn't break
 * discovery.
 *
 * @param {object} [opts]
 * @param {string} [opts.target] When provided, only this single broadcast address is used.
 * @param {number} [opts.timeoutMs=5000]
 * @param {object} [opts.logger]
 */
function discover(opts = {}) {
    const log = makeLogger(opts.logger);
    const explicitTarget = opts.target || null;
    const targets = explicitTarget ? [explicitTarget] : enumerateBroadcastTargets();
    const ports = [UDP_PORT, UDP_PORT_ALT];
    const timeoutMs = opts.timeoutMs || 5000;

    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        const found = new Map();
        /** @type {Promise<any>[]} */
        const pendingV1 = [];

        log.debug(`discover: starting UDP broadcast targets=[${targets.join(",")}] ports=[${ports.join(",")}] timeoutMs=${timeoutMs}`);

        socket.on("message", (msg, info) => {
            try {
                // V1 XML reply: <?xml … <device port="…" apc_sn="…" apc_type="…">.
                if (msg.length >= 6 && msg.subarray(0, 6).toString("hex") === "3c3f786d6c20") {
                    const partial = parseV1Reply(msg, info.address, log);
                    if (!partial) return;
                    pendingV1.push(
                        enrichV1WithDeviceId(partial, log).then((dev) => {
                            if (dev && !found.has(dev.id)) {
                                found.set(dev.id, dev);
                                log.debug(`discover: ${info.address} -> id=${dev.id} type=0x${dev.applianceType.toString(16)} (${dev.applianceTypeName}) protocol=1`);
                            }
                        }).catch((err) => {
                            log.warn(`discover[v1]: enrich failed for ${info.address} (${err && err.message})`);
                        }),
                    );
                    return;
                }
                const dev = parseDiscoveryReply(msg, info.address);
                if (dev && !found.has(dev.id)) {
                    found.set(dev.id, dev);
                    log.debug(`discover: ${info.address} -> id=${dev.id} type=0x${dev.applianceType.toString(16)} (${dev.applianceTypeName}) protocol=${dev.protocol}`);
                }
            } catch (err) {
                log.warn(`discover: failed to parse reply from ${info.address} (${err.message})`);
            }
        });

        socket.on("error", (err) => {
            log.warn(`discover: socket error ${err.message}`);
            try { socket.close(); } catch (_e) { /* swallow */ }
            Promise.allSettled(pendingV1).then(() => resolve(Array.from(found.values())));
        });

        const finish = () => {
            try { socket.close(); } catch (_e) { /* swallow */ }
            Promise.allSettled(pendingV1).then(() => {
                log.debug(`discover: finished, ${found.size} appliance(s)`);
                resolve(Array.from(found.values()));
            });
        };

        socket.bind(0, () => {
            try {
                socket.setBroadcast(true);
            } catch (err) {
                log.warn(`discover: setBroadcast failed (${err.message})`);
            }
            for (const target of targets) {
                for (const port of ports) {
                    socket.send(BROADCAST, 0, BROADCAST.length, port, target, (err) => {
                        if (err) {
                            log.debug(`discover: broadcast send failed ${target}:${port} (${err.message})`);
                        }
                    });
                }
            }
            setTimeout(finish, timeoutMs);
        });
    });
}

module.exports = { discover, parseDiscoveryReply, enumerateBroadcastTargets, computeBroadcast, APPLIANCE_TYPES, UDP_PORT, UDP_PORT_ALT };
