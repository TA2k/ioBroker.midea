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
 * Enumerate all IPv4 unicast/private/non-loopback interfaces with their
 * address, prefix and directed broadcast. Returns an array — the same iface
 * may appear multiple times if it has more than one IPv4 address.
 *
 * @returns {{name: string, address: string, prefix: number, broadcast: string}[]}
 */
function enumerateInterfacesV4() {
    const ifaces = os.networkInterfaces();
    /** @type {{name: string, address: string, prefix: number, broadcast: string}[]} */
    const out = [];
    for (const [name, list] of Object.entries(ifaces)) {
        if (!list) continue;
        for (const iface of list) {
            if (iface.family !== "IPv4" || iface.internal) continue;
            if (!iface.cidr) continue;
            const slash = iface.cidr.indexOf("/");
            if (slash < 0) continue;
            const prefix = Number(iface.cidr.slice(slash + 1));
            const bcast = computeBroadcast(iface.address, prefix);
            if (!bcast || bcast === "255.255.255.255") continue;
            out.push({ name, address: iface.address, prefix, broadcast: bcast });
        }
    }
    return out;
}

/**
 * Enumerate all IPv4 unicast/private/non-loopback interfaces and return their
 * directed broadcast addresses. Mirrors midea-local's
 * `enum_all_broadcast` helper. Falls back to ["255.255.255.255"] when no
 * usable interface is found.
 */
function enumerateBroadcastTargets() {
    const targets = new Set(enumerateInterfacesV4().map((i) => i.broadcast));
    if (targets.size === 0) targets.add("255.255.255.255");
    return Array.from(targets);
}

/**
 * Return true if `ip` falls inside the IPv4 subnet defined by `address/prefix`.
 *
 * @param {string} ip
 * @param {string} address
 * @param {number} prefix
 */
function ipInSubnet(ip, address, prefix) {
    const a = ip.split(".").map((/** @type {string} */ s) => Number(s));
    const b = address.split(".").map((/** @type {string} */ s) => Number(s));
    if (a.length !== 4 || b.length !== 4) return false;
    if (a.some((/** @type {number} */ x) => Number.isNaN(x)) || b.some((/** @type {number} */ x) => Number.isNaN(x))) return false;
    if (prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const ai = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
    const bi = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const mask = ((~0 << (32 - prefix)) >>> 0);
    return (ai & mask) === (bi & mask);
}

/**
 * Pick the local IPv4 interface whose subnet contains `ip`, or null. Used to
 * annotate received packets with "this came in on en0".
 *
 * @param {string} ip
 * @param {{name: string, address: string, prefix: number, broadcast: string}[]} ifaces
 */
function findIfaceForIp(ip, ifaces) {
    for (const i of ifaces) {
        if (ipInSubnet(ip, i.address, i.prefix)) return i;
    }
    return null;
}

const APPLIANCE_TYPES = {
    0x13: "light",
    0x26: "bathroom_heater",
    0x34: "dishwasher_x34",
    0x40: "bathroom_fan",
    0xA1: "dehumidifier",
    0xAC: "ac",
    0xAD: "air_box",
    0xB0: "microwave",
    0xB1: "oven",
    0xB3: "steamer",
    0xB4: "oven_steam",
    0xB6: "range_hood",
    0xB8: "vacuum",
    0xBF: "integrated_oven",
    0xC2: "smart_toilet",
    0xC3: "heat_pump_controller",
    0xCA: "refrigerator",
    0xCC: "commercial_ac",
    0xCD: "heat_pump_water",
    0xCE: "fresh_air",
    0xCF: "heatpump",
    0xDA: "top_load_washer",
    0xDB: "front_load_washer",
    0xDC: "dryer",
    0xE1: "dishwasher",
    0xE2: "electric_water_heater",
    0xE3: "gas_water_heater",
    0xE6: "gas_boiler",
    0xE8: "pressure_cooker",
    0xEA: "rice_cooker_ea",
    0xEC: "rice_cooker_ec",
    0xED: "water_purifier",
    0xFA: "fan",
    0xFB: "electric_heater",
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

    // Some appliances reply with garbled-looking encrypted blobs that decrypt
    // to short / nonsensical buffers. Mirrors midea-local discover.py change
    // (commit 2f464d0) — skip rather than crash on the byte access below.
    const DISCOVERY_MIN_REPLY_LENGTH = 41;
    if (data.length <= DISCOVERY_MIN_REPLY_LENGTH || data[40] + DISCOVERY_MIN_REPLY_LENGTH > data.length) {
        return null;
    }

    const ssidLen = data[40];
    const ssid = data.subarray(41, 41 + ssidLen).toString();

    // Long discovery reply (msmart layout): MAC at 63+ssidLen, firmware at
    // 72..74+ssidLen, applianceType at 55+ssidLen.
    //
    // Short discovery reply (midea-local layout, seen on some 0xAC firmware):
    // only ip/port/sn/ssid are populated, the MAC + firmware block is absent
    // and the encrypted body is PKCS#7-padded to 64 bytes. The appliance
    // type lives inside the SSID (`net_<TYPE>_<MAC4>`).
    let macAddress = "";
    let firmwareVersion = "";
    let applianceType;
    let applianceSubType = 0;

    if (data.length >= 75 + ssidLen) {
        const macStart = 63 + ssidLen;
        const macParts = [];
        for (let i = 0; i < 6; i++) macParts.push(data[macStart + i].toString(16).padStart(2, "0"));
        macAddress = macParts.join(":");
        const subTypeHex = data.subarray(57 + ssidLen, 59 + ssidLen).toString("hex");
        applianceSubType = parseInt(reverseHex(subTypeHex), 16);
        applianceType = data[55 + ssidLen];
        firmwareVersion = `${data[72 + ssidLen]}.${data[73 + ssidLen]}.${data[74 + ssidLen]}`;
    } else {
        // Derive type from SSID: hex string in `net_<typeHex>_<MAC4>`. SSIDs
        // observed include `net_ac_FB2C`, `net_a1_…`, `net_cd_…` — the middle
        // segment is the appliance-type byte in lowercase hex.
        const segs = ssid.split("_");
        if (segs.length >= 3) {
            const t = parseInt(segs[1], 16);
            if (Number.isFinite(t)) applianceType = t & 0xff;
        }
        if (applianceType === undefined) return null;
    }

    const appliance = {
        id,
        host: sourceAddress,
        port: parseInt(reverseHex(data.subarray(4, 8).toString("hex")), 16),
        sn: trimNul(data.subarray(8, 40).toString()),
        ssid,
        macAddress,
        applianceType,
        applianceTypeName: APPLIANCE_TYPES[applianceType] || "unknown",
        applianceSubType,
        firmwareVersion,
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
 * @param {string[]} [opts.targets] When provided, this list of broadcast/unicast addresses is used. Overrides `target` and the auto-enumerated broadcast targets — caller is responsible for including any broadcast addresses it still wants covered.
 * @param {number} [opts.timeoutMs=5000]
 * @param {object} [opts.logger]
 */
function discover(opts = {}) {
    const log = makeLogger(opts.logger);
    const explicitTargets = Array.isArray(opts.targets) && opts.targets.length
        ? opts.targets
        : (opts.target ? [opts.target] : null);
    const ifaces = enumerateInterfacesV4();
    const targets = explicitTargets || (ifaces.length ? Array.from(new Set(ifaces.map((i) => i.broadcast))) : ["255.255.255.255"]);
    const ports = [UDP_PORT, UDP_PORT_ALT];
    const timeoutMs = opts.timeoutMs || 5000;
    // For each target, the local interface(s) it belongs to (for tx logging).
    /** @type {Map<string, {name: string, address: string, prefix: number}[]>} */
    const targetToIfaces = new Map();
    for (const t of targets) {
        const matches = ifaces.filter((i) => i.broadcast === t || ipInSubnet(t, i.address, i.prefix));
        if (matches.length) targetToIfaces.set(t, matches.map((i) => ({ name: i.name, address: i.address, prefix: i.prefix })));
    }

    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        const found = new Map();
        /** @type {Promise<any>[]} */
        const pendingV1 = [];

        const ifaceSummary = ifaces.length
            ? ifaces.map((i) => `${i.name}(${i.address}/${i.prefix}->${i.broadcast})`).join(", ")
            : "(no usable IPv4 interface, falling back to 255.255.255.255)";
        log.debug(`discover: local interfaces: ${ifaceSummary}`);
        log.debug(`discover: starting UDP broadcast targets=[${targets.join(",")}] ports=[${ports.join(",")}] timeoutMs=${timeoutMs}`);

        socket.on("message", (msg, info) => {
            const iface = findIfaceForIp(info.address, ifaces);
            const via = iface ? ` via ${iface.name}(${iface.address}/${iface.prefix})` : "";
            log.debug(`discover: rx ${msg.length}B from ${info.address}:${info.port}${via}`);
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
                } else if (!dev) {
                    log.debug(`discover: ${info.address} reply did not parse (${msg.length}B: ${msg.toString("hex")})`);
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
                const ifaceLabel = (targetToIfaces.get(target) || [])
                    .map((i) => `${i.name}(${i.address}/${i.prefix})`)
                    .join(",") || "(unknown iface)";
                for (const port of ports) {
                    socket.send(BROADCAST, 0, BROADCAST.length, port, target, (err) => {
                        if (err) {
                            log.debug(`discover: tx failed -> ${target}:${port} via ${ifaceLabel} (${err.message})`);
                        } else {
                            log.debug(`discover: tx ${BROADCAST.length}B -> ${target}:${port} via ${ifaceLabel}`);
                        }
                    });
                }
            }
            setTimeout(finish, timeoutMs);
        });
    });
}

module.exports = { discover, parseDiscoveryReply, enumerateBroadcastTargets, computeBroadcast, APPLIANCE_TYPES, UDP_PORT, UDP_PORT_ALT };
