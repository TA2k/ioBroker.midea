"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_PRESSURE_COOKER = 0xE8;
const APPLIANCE_TYPE_RICE_COOKER_EA = 0xEA;
const APPLIANCE_TYPE_RICE_COOKER_EC = 0xEC;

function parseE8Body(body) {
    const out = {};
    if (!body || body.length < 44) return out;
    out.statusCode = body[11];
    out.timeRemaining = body[16] * 3600 + body[17] * 60 + body[18];
    out.keepWarmRemaining = body[19] * 3600 + body[20] * 60 + body[21];
    out.workingTime = body[28] * 3600 + body[29] * 60 + body[30];
    out.targetTemperature = body[39];
    out.currentTemperature = body[39];
    out.finished = (body[41] & 0x01) > 0;
    out.waterShortage = body[43] > 0;
    return out;
}

function parseEABody(body) {
    const out = {};
    if (!body || body.length < 24) return out;
    out.mode = body[4] + (body[5] << 8);
    out.progress = body[8];
    out.cooking = body[8] === 2;
    out.keepWarm = body[8] === 3;
    out.timeRemaining = body[12] * 60 + body[13];
    out.topTemperature = body[20];
    out.bottomTemperature = body[21];
    out.keepWarmTime = body[22] * 60 + body[23];
    return out;
}

function parseECBody(body) {
    const out = {};
    if (!body || body.length < 24) return out;
    out.mode = body[4] + (body[5] << 8);
    out.progress = body[8];
    out.cooking = body[8] === 1;
    out.timeRemaining = body[12] * 60 + body[13];
    out.keepWarmTime = body[16] * 60 + body[17];
    out.topTemperature = body[21];
    out.bottomTemperature = body[22];
    out.withPressure = (body[23] & 0x04) > 0;
    return out;
}

class _ReadOnlyCooker extends BaseDevice {
    async refreshCapabilities() { return null; }
    async setStatus() { return this.status; }
}

class PressureCookerDevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_PRESSURE_COOKER; }

    async refreshStatus() {
        // E8 query: body_type 0xAA, body=[0x55, 0x00, 0x01, 0x00, 0x00]
        const body = Buffer.from([0xAA, 0x55, 0x00, 0x01, 0x00, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_PRESSURE_COOKER, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseE8Body(inner));
        return this.status;
    }
}

class RiceCookerEADevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_RICE_COOKER_EA; }

    async refreshStatus() {
        // EA query: raw body=[0xAA, 0x55, 0x01, 0x03, 0x00]
        const body = Buffer.from([0xAA, 0x55, 0x01, 0x03, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RICE_COOKER_EA, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseEABody(inner));
        return this.status;
    }
}

class RiceCookerECDevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_RICE_COOKER_EC; }

    async refreshStatus() {
        // EC query: raw body=[0xAA, 0x55, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
        const body = Buffer.from([0xAA, 0x55, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RICE_COOKER_EC, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseECBody(inner));
        return this.status;
    }
}

module.exports = {
    PressureCookerDevice, APPLIANCE_TYPE_PRESSURE_COOKER,
    RiceCookerEADevice, APPLIANCE_TYPE_RICE_COOKER_EA,
    RiceCookerECDevice, APPLIANCE_TYPE_RICE_COOKER_EC,
};
