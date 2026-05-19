"use strict";

const { BaseDevice } = require("./base");
const { addHeader0xAA, calculateChecksum } = require("../packet");

const APPLIANCE_TYPE_ELECTRIC_HEATER = 0xFB;

/**
 * 0xFB electric heater. midea-local overrides body to drop the body_type
 * prefix. Query body is empty; set body is 20 (or 23 for subtype>5).
 */
function buildFBFrame(body, msgType) {
    let cmd = addHeader0xAA(body, {
        msgType,
        protocol: 0x03,
        applianceType: APPLIANCE_TYPE_ELECTRIC_HEATER,
    });
    cmd = Buffer.concat([cmd, Buffer.from([calculateChecksum(cmd)])]);
    return cmd;
}

function parseFBBody(body) {
    const out = {};
    if (!body || body.length < 14) return out;
    out.powerOn = ![0, 2].includes(body[0] & 0x01);
    out.modeIndex = body[4];
    out.heatingLevel = body[5];
    out.targetTemperature = body[6] - 41;
    if (body[7] >= 1 && body[7] <= 100) {
        out.targetHumidity = body[7];
        out.currentHumidity = body[12];
    }
    out.currentTemperature = body[13] - 20;
    if (body.length > 18) out.childLock = (body[18] & 0x01) > 0;
    if (body.length > 21) out.energyConsumption = (body[21] << 8) + body[20];
    return out;
}

class ElectricHeaterDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.subtype = Number(opts.applianceSubType || opts.subtype || 0);
    }

    get applianceType() { return APPLIANCE_TYPE_ELECTRIC_HEATER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = buildFBFrame(Buffer.alloc(0), 0x03);
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseFBBody(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        const power = updates.powerOn === undefined ? 0 : (updates.powerOn ? 0x01 : 0x02);
        const mode = updates.mode === undefined ? 0 : Number(updates.mode);
        const heatingLevel = updates.heatingLevel === undefined
            ? 0
            : (Number(updates.heatingLevel) >= 1 && Number(updates.heatingLevel) <= 10 ? Number(updates.heatingLevel) : 0);
        let target;
        if (updates.targetTemperature === undefined) {
            target = 0;
        } else {
            const v = Number(updates.targetTemperature);
            target = v >= -40 && v <= 50 ? (v + 41) & 0xFF : (v === 0x80 || v === 87 ? 0x80 : 0);
        }
        const childLock = updates.childLock === undefined ? 0xFF : (updates.childLock ? 0x01 : 0x00);
        const baseLen = this.subtype > 5 ? 23 : 20;
        const body = Buffer.alloc(baseLen);
        body[0] = power;
        body[4] = mode;
        body[5] = heatingLevel;
        body[6] = target;
        body[18] = childLock;
        const cmd = buildFBFrame(body, 0x02);
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseFBBody(inner));
        } catch (err) {
            this.log.debug(`FB[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { ElectricHeaterDevice, APPLIANCE_TYPE_ELECTRIC_HEATER };
