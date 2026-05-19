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
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseFBBody(inner));
    }

    async setStatus(updates = {}) {
        const cur = this.status || {};
        const fld = (k) => updates[k] !== undefined ? updates[k] : cur[k];
        const powerVal = fld("powerOn");
        const power = powerVal === undefined ? 0 : (powerVal ? 0x01 : 0x02);
        const modeVal = fld("mode");
        const mode = modeVal === undefined ? 0 : Number(modeVal);
        const heatingLevelVal = fld("heatingLevel");
        const heatingLevel = heatingLevelVal === undefined
            ? 0
            : (Number(heatingLevelVal) >= 1 && Number(heatingLevelVal) <= 10 ? Number(heatingLevelVal) : 0);
        const targetVal = fld("targetTemperature");
        let target;
        if (targetVal === undefined) {
            target = 0;
        } else {
            const v = Number(targetVal);
            target = v >= -40 && v <= 50 ? (v + 41) & 0xFF : (v === 0x80 || v === 87 ? 0x80 : 0);
        }
        const childLockVal = fld("childLock");
        const childLock = childLockVal === undefined ? 0xFF : (childLockVal ? 0x01 : 0x00);
        const baseLen = this.subtype > 5 ? 23 : 20;
        const body = Buffer.alloc(baseLen);
        body[0] = power;
        body[4] = mode;
        body[5] = heatingLevel;
        body[6] = target;
        body[18] = childLock;
        const cmd = buildFBFrame(body, 0x02);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { ElectricHeaterDevice, APPLIANCE_TYPE_ELECTRIC_HEATER };
