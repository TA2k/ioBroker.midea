"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_PRESSURE_COOKER = 0xE8;
const APPLIANCE_TYPE_RICE_COOKER_EA = 0xEA;
const APPLIANCE_TYPE_RICE_COOKER_EC = 0xEC;

const PROGRESS_COOKING = 2;
const PROGRESS_KEEP_WARM = 3;

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

// EABody1: proto 0 set body[5]==0x16 or proto 0 query/notify body[5]==0x3D
function parseEABody1(body) {
    const out = {};
    if (!body || body.length < 28) return out;
    out.mode = body[6] + (body[7] << 8);
    out.progress = body[14];
    out.cooking = body[14] === PROGRESS_COOKING;
    out.keepWarm = body[14] === PROGRESS_KEEP_WARM;
    out.topTemperature = body[18];
    out.bottomTemperature = body[19];
    out.timeRemaining = body[22] * 60 + body[23];
    out.keepWarmTime = body[26] * 60 + body[27];
    return out;
}

// EABody2: proto 0 query, body[6]==0x52 && body[7]==0xC3
function parseEABody2(body) {
    const out = {};
    if (!body || body.length < 60) return out;
    out.progress = body[9];
    out.cooking = body[9] === PROGRESS_COOKING;
    out.keepWarm = body[9] === PROGRESS_KEEP_WARM;
    out.mode = body[58] + (body[59] << 8);
    out.timeRemaining = body[50] * 60 + body[51];
    out.keepWarmTime = body[54] * 60 + body[55];
    out.topTemperature = body[21];
    out.bottomTemperature = body[20];
    return out;
}

// EABody3: proto != 0, body[3] in {0x02 set, 0x03 query, 0x04 notify}
function parseEABody3(body) {
    const out = {};
    if (!body || body.length < 24) return out;
    out.mode = body[4] + (body[5] << 8);
    out.progress = body[8];
    out.cooking = body[8] === PROGRESS_COOKING;
    out.keepWarm = body[8] === PROGRESS_KEEP_WARM;
    out.timeRemaining = body[12] * 60 + body[13];
    out.topTemperature = body[20];
    out.bottomTemperature = body[21];
    out.keepWarmTime = body[22] * 60 + body[23];
    return out;
}

// EABodyNew: notify body[3]==0x01, body[6] in {2,4,6,8,10,0x62}
function parseEABodyNew(body) {
    const out = {};
    if (!body || body.length < 62) return out;
    if (![2, 4, 6, 8, 10, 0x62].includes(body[6])) return out;
    out.mode = body[7] + (body[8] << 8);
    out.progress = body[11];
    out.cooking = body[11] === PROGRESS_COOKING;
    out.keepWarm = body[11] === PROGRESS_KEEP_WARM;
    out.timeRemaining = body[16] * 60 + body[17];
    out.keepWarmTime = body[19] * 60 + body[20];
    out.topTemperature = body[60];
    out.bottomTemperature = body[61];
    return out;
}

function dispatchEA(body, msgType) {
    if (!body || body.length < 4) return {};
    // notify1=0x05 in midea-local but our wire msgType is the same
    if (msgType === 0x05 && body[3] === 0x01) return parseEABodyNew(body);
    if (msgType === 0x05 && body[3] === 0x06) {
        return body.length >= 6 ? { mode: body[4] + (body[5] << 8) } : {};
    }
    // proto 3 (modern) dispatch
    if ((msgType === 0x02 && body[3] === 0x02)
        || (msgType === 0x03 && body[3] === 0x03)
        || (msgType === 0x05 && body[3] === 0x04)) return parseEABody3(body);
    // proto 0 (legacy) dispatch
    if (msgType === 0x02 && body.length > 5 && body[5] === 0x16) return parseEABody1(body);
    if (msgType === 0x03 && body.length > 7 && body[6] === 0x52 && body[7] === 0xC3) return parseEABody2(body);
    if ((msgType === 0x03 || msgType === 0x05) && body.length > 5 && body[5] === 0x3D) return parseEABody1(body);
    return {};
}

// ECGeneralMessageBody: body[3] in {0x02, 0x03, 0x04, 0x3D}
function parseECGeneral(body) {
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

// ECBodyNew: notify body[3]==0x01
function parseECBodyNew(body) {
    const out = {};
    if (!body || body.length < 50) return out;
    out.progress = body[11];
    out.cooking = body[11] === 1;
    out.timeRemaining = body[16] * 60 + body[17];
    out.keepWarmTime = body[19] * 60 + body[20];
    out.topTemperature = body[48];
    out.bottomTemperature = body[49];
    out.withPressure = body[33] > 0;
    return out;
}

function dispatchEC(body, msgType) {
    if (!body || body.length < 4) return {};
    if (msgType === 0x05 && body[3] === 0x01) return parseECBodyNew(body);
    if (msgType === 0x05 && body[3] === 0x06) {
        return body.length >= 6 ? { mode: body[4] + (body[5] << 8) } : {};
    }
    if ((msgType === 0x02 && body[3] === 0x02)
        || (msgType === 0x03 && body[3] === 0x03)
        || (msgType === 0x05 && body[3] === 0x04)
        || (msgType === 0x05 && body[3] === 0x3D)) return parseECGeneral(body);
    return {};
}

class _ReadOnlyCooker extends BaseDevice {
    async refreshCapabilities() { return null; }
    async setStatus() { return this.status; }
}

class PressureCookerDevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_PRESSURE_COOKER; }

    async refreshStatus() {
        const body = Buffer.from([0xAA, 0x55, 0x00, 0x01, 0x00, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_PRESSURE_COOKER, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseE8Body(inner));
    }
}

class RiceCookerEADevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_RICE_COOKER_EA; }

    async refreshStatus() {
        const body = Buffer.from([0xAA, 0x55, 0x01, 0x03, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RICE_COOKER_EA, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, ctx) {
        if (!frame || frame.length < 12) return undefined;
        const msgType = (ctx && ctx.msgType) != null ? ctx.msgType : frame[9];
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(dispatchEA(inner, msgType));
    }
}

class RiceCookerECDevice extends _ReadOnlyCooker {
    get applianceType() { return APPLIANCE_TYPE_RICE_COOKER_EC; }

    async refreshStatus() {
        const body = Buffer.from([0xAA, 0x55, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RICE_COOKER_EC, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, ctx) {
        if (!frame || frame.length < 12) return undefined;
        const msgType = (ctx && ctx.msgType) != null ? ctx.msgType : frame[9];
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(dispatchEC(inner, msgType));
    }
}

module.exports = {
    PressureCookerDevice, APPLIANCE_TYPE_PRESSURE_COOKER,
    RiceCookerEADevice, APPLIANCE_TYPE_RICE_COOKER_EA,
    RiceCookerECDevice, APPLIANCE_TYPE_RICE_COOKER_EC,
    parseE8Body, parseEABody1, parseEABody2, parseEABody3, parseEABodyNew,
    parseECGeneral, parseECBodyNew, dispatchEA, dispatchEC,
};
