"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_WATER_PURIFIER = 0xED;

function parseED01(body) {
    const out = {};
    if (!body || body.length < 40) return out;
    out.powerOn = (body[2] & 0x01) > 0;
    out.waterConsumption = body[7] + (body[8] << 8);
    out.inTds = body[36] + (body[37] << 8);
    out.outTds = body[38] + (body[39] << 8);
    out.childLock = body[15] > 0;
    out.life1 = body[16];
    out.life2 = body[17];
    out.life3 = body[18];
    out.filter1 = Math.round((body[25] + (body[26] << 8)) / 24);
    out.filter2 = Math.round((body[27] + (body[28] << 8)) / 24);
    out.filter3 = Math.round((body[29] + (body[30] << 8)) / 24);
    return out;
}

function parseED03(body) {
    const out = {};
    if (!body || body.length < 52) return out;
    out.powerOn = (body[51] & 0x01) > 0;
    out.childLock = (body[51] & 0x08) > 0;
    out.waterConsumption = body[20] + (body[21] << 8);
    out.life1 = body[22];
    out.life2 = body[23];
    out.life3 = body[24];
    out.inTds = body[27] + (body[28] << 8);
    out.outTds = body[29] + (body[30] << 8);
    return out;
}

function parseED05(body) {
    const out = {};
    if (!body || body.length < 52) return out;
    out.powerOn = (body[51] & 0x01) > 0;
    out.childLock = (body[51] & 0x08) > 0;
    out.waterConsumption = body[20] + (body[21] << 8);
    return out;
}

function parseED06(body) {
    const out = {};
    if (!body || body.length < 52) return out;
    out.powerOn = (body[51] & 0x01) > 0;
    out.childLock = (body[51] & 0x08) > 0;
    out.waterConsumption = body[25] + (body[26] << 8);
    return out;
}

function parseED07(body) {
    const out = {};
    if (!body || body.length < 52) return out;
    out.powerOn = (body[51] & 0x01) > 0;
    out.childLock = (body[51] & 0x08) > 0;
    out.waterConsumption = (body[21] << 8) + body[20];
    return out;
}

function parseEDFF(body) {
    const out = {};
    if (!body || body.length < 8) return out;
    let off = 2;
    while (off + 6 < body.length) {
        const length = (body[off + 2] >> 4) + 2;
        const attr = ((body[off + 2] % 16) << 8) + body[off + 1];
        if (attr === 0x000) {
            out.childLock = (body[off + 5] & 0x01) > 0;
            out.powerOn = (body[off + 6] & 0x01) > 0;
        } else if (attr === 0x011) {
            out.waterConsumption = (body[off + 3] + (body[off + 4] << 8)
                + (body[off + 5] << 16) + (body[off + 6] << 24)) / 1000;
        } else if (attr === 0x013) {
            out.inTds = body[off + 3] + (body[off + 4] << 8);
            out.outTds = body[off + 5] + (body[off + 6] << 8);
        } else if (attr === 0x010) {
            out.life1 = body[off + 3];
            out.life2 = body[off + 4];
            out.life3 = body[off + 5];
        }
        if (off + length + 6 > body.length) break;
        off += length;
    }
    return out;
}

function parseED(body) {
    if (!body) return {};
    const bt = body[0];
    if (bt === 0x01) return parseED01(body);
    if (bt === 0x03 || bt === 0x04) return parseED03(body);
    if (bt === 0x05) return parseED05(body);
    if (bt === 0x06) return parseED06(body);
    if (bt === 0x07) return parseED07(body);
    if (bt === 0x00 || bt === 0x15 || bt === 0xFF) return parseEDFF(body);
    return {};
}

class WaterPurifierDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_WATER_PURIFIER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        for (const bt of [0x01, 0x03, 0xFF]) {
            try {
                const cmd = createCommand(Buffer.from([bt, 0x01]), {
                    msgType: 0x03, protocol: 0x03,
                    applianceType: APPLIANCE_TYPE_WATER_PURIFIER, addCrc: false,
                });
                const reply = await this._request(cmd, `getStatus_${bt.toString(16)}`);
                const inner = reply.subarray(10, reply.length - 1);
                this._mergeStatus(parseED(inner));
                return this.status;
            } catch (err) {
                this.log.debug(`ED[${this.id}]: query ${bt.toString(16)} failed (${err.message})`);
            }
        }
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn === undefined && updates.childLock === undefined) return this.status;
        let count = 0;
        const packs = [];
        if (updates.powerOn !== undefined) {
            count++;
            packs.push(0x00, 0x01, updates.powerOn ? 0x01 : 0x00, 0x00, 0x00);
        }
        if (updates.childLock !== undefined) {
            count++;
            packs.push(0x01, 0x02, updates.childLock ? 0x01 : 0x00, 0x00, 0x00);
        }
        const body = Buffer.concat([Buffer.from([0x15, 0x01, count]), Buffer.from(packs)]);
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_WATER_PURIFIER, addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseED(inner));
        } catch (err) {
            this.log.debug(`ED[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { WaterPurifierDevice, APPLIANCE_TYPE_WATER_PURIFIER };
