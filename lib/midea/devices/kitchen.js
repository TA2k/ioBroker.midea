"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_OVEN = 0xB1;
const APPLIANCE_TYPE_STEAMER = 0xB3;
const APPLIANCE_TYPE_OVEN_STEAM = 0xB4;
const APPLIANCE_TYPE_INTEGRATED_OVEN = 0xBF;

function parseKitchenStandard(body) {
    const out = {};
    if (!body || body.length < 33) return out;
    out.statusCode = body[31];
    const h = body[22] === 0xFF ? 0 : body[22];
    const m = body[23] === 0xFF ? 0 : body[23];
    const s = body[24] === 0xFF ? 0 : body[24];
    out.timeRemaining = h * 3600 + m * 60 + s;
    let temp = (body[25] << 8) + body[26];
    if (temp === 0) temp = (body[27] << 8) + body[28];
    out.currentTemperature = temp;
    out.door = (body[32] & 0x02) > 0;
    out.tankEjected = (body[32] & 0x04) > 0;
    out.waterShortage = (body[32] & 0x08) > 0;
    out.waterChangeReminder = (body[32] & 0x10) > 0;
    if (out.statusCode === undefined) return out;
    return out;
}

function parseB1(body) {
    const out = {};
    if (!body || body.length < 20) return out;
    out.door = (body[16] & 0x02) > 0;
    out.statusCode = body[1];
    const h = body[6] === 0xFF ? 0 : body[6];
    const m = body[7] === 0xFF ? 0 : body[7];
    const s = body[8] === 0xFF ? 0 : body[8];
    out.timeRemaining = h * 3600 + m * 60 + s;
    out.currentTemperature = body[19];
    out.tankEjected = (body[16] & 0x04) > 0;
    out.waterShortage = (body[16] & 0x08) > 0;
    out.waterChangeReminder = (body[16] & 0x10) > 0;
    return out;
}

function parseB3_31(body) {
    const out = {};
    if (!body || body.length < 32) return out;
    out.topStatus = body[1];
    out.topMode = body[2];
    out.topTemperature = body[3];
    out.bottomStatus = body[6];
    out.bottomMode = body[7];
    out.bottomTemperature = body[8];
    out.middleStatus = body[17];
    out.middleMode = body[18];
    out.middleTemperature = body[19];
    out.lock = (body[11] & 0x01) > 0;
    out.bottomDoor = (body[11] & 0x02) > 0;
    out.topDoor = (body[11] & 0x04) > 0;
    out.middleDoor = (body[11] & 0x10) > 0;
    out.bottomPreheating = (body[16] & 0x01) > 0;
    out.topPreheating = (body[16] & 0x02) > 0;
    out.middlePreheating = (body[16] & 0x10) > 0;
    out.bottomCooling = (body[16] & 0x04) > 0;
    out.topCooling = (body[16] & 0x08) > 0;
    out.middleCooling = (body[16] & 0x20) > 0;
    return out;
}

class _ReadOnlyKitchen extends BaseDevice {
    async refreshCapabilities() { return null; }
    async setStatus() { return this.status; }
}

class OvenDevice extends _ReadOnlyKitchen {
    get applianceType() { return APPLIANCE_TYPE_OVEN; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x00]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_OVEN, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseB1(inner));
        return this.status;
    }
}

class SteamerDevice extends _ReadOnlyKitchen {
    get applianceType() { return APPLIANCE_TYPE_STEAMER; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x31]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_STEAMER, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseB3_31(inner));
        return this.status;
    }
}

class OvenSteamDevice extends _ReadOnlyKitchen {
    get applianceType() { return APPLIANCE_TYPE_OVEN_STEAM; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_OVEN_STEAM, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseKitchenStandard(inner));
        return this.status;
    }
}

class IntegratedOvenDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_INTEGRATED_OVEN; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_INTEGRATED_OVEN, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseKitchenStandard(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn === undefined && updates.childLock === undefined) return this.status;
        const power = updates.powerOn === undefined ? 0xFF : (updates.powerOn ? 0x11 : 0x01);
        const childLock = updates.childLock === undefined ? 0xFF : (updates.childLock ? 0x01 : 0x00);
        const body = Buffer.concat([
            Buffer.from([0x02, power, childLock]),
            Buffer.alloc(7, 0xFF),
        ]);
        // BF uses message_type query for set per upstream (oddity)
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_INTEGRATED_OVEN, addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseKitchenStandard(inner));
        } catch (err) {
            this.log.debug(`BF[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = {
    OvenDevice, APPLIANCE_TYPE_OVEN,
    SteamerDevice, APPLIANCE_TYPE_STEAMER,
    OvenSteamDevice, APPLIANCE_TYPE_OVEN_STEAM,
    IntegratedOvenDevice, APPLIANCE_TYPE_INTEGRATED_OVEN,
};
