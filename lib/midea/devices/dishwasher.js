"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_DISHWASHER = 0xE1;

function parseE1Body(body) {
    const out = {};
    if (!body || body.length < 12) return out;
    out.powerOn = body[1] > 0;
    out.statusCode = body[1];
    out.mode = body[2];
    out.additional = body[3];
    out.doorOpen = (body[5] & 0x01) === 0;
    out.lackRinseAid = (body[5] & 0x02) > 0;
    out.lackSalt = (body[5] & 0x04) > 0;
    const startPause = (body[5] & 0x08) > 0;
    if (startPause) out.start = true;
    else if (body[1] === 2 || body[1] === 3) out.start = false;
    out.diy = (body[4] & 0x08) > 0;
    out.childLock = (body[5] & 0x10) > 0;
    out.uv = (body[4] & 0x02) > 0;
    out.dry = (body[4] & 0x10) > 0;
    out.dryStatus = (body[4] & 0x20) > 0;
    out.dryStepSwitch = (body[4] & 0x01) > 0;
    out.storage = (body[5] & 0x20) > 0;
    out.storageStatus = (body[5] & 0x40) > 0;
    out.timeRemaining = body[6];
    if (body.length > 33) {
        const high = body[32];
        if (high) out.timeRemaining = high * 256 + body[6];
    }
    out.progress = body[9];
    if (body.length > 18) {
        out.storageSetTime = body[17];
        out.storageRemaining = body[18];
    }
    out.temperature = body[11];
    if (body.length > 33) out.humidity = body[33];
    out.waterSwitch = (body[4] & 0x04) > 0;
    out.waterLack = (body[5] & 0x80) > 0;
    out.errorCode = body[10];
    out.softWater = body[13];
    out.wrongOperation = body[16];
    if (body.length > 24) out.bright = body[24];
    return out;
}

class DishwasherDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_DISHWASHER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.from([0x00]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DISHWASHER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseE1Body(inner));
    }

    async _send(body, label) {
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DISHWASHER,
            addCrc: false,
        });
        const reply = await this._request(cmd, label);
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const body = Buffer.from([0x08, updates.powerOn ? 0x01 : 0x00, 0x00, 0x00, 0x00]);
            return this._send(body, "setPower");
        }
        if (updates.work !== undefined || updates.mode !== undefined) {
            const workStatus = updates.work !== undefined ? Number(updates.work) : 0x03;
            const mode = updates.mode !== undefined ? Number(updates.mode) : 0;
            const body = Buffer.from([0x08, workStatus, mode, 0x00, 0x00]);
            return this._send(body, "setWork");
        }
        if (updates.childLock !== undefined) {
            const tail = Buffer.alloc(36, 0x00);
            const body = Buffer.concat([Buffer.from([0x83, updates.childLock ? 0x03 : 0x04]), tail]);
            return this._send(body, "setLock");
        }
        if (updates.storage !== undefined) {
            const head = Buffer.from([0x81, 0x00, 0x00, 0x00, updates.storage ? 0x01 : 0x00]);
            const fixed = Buffer.alloc(6, 0xFF);
            const tail = Buffer.alloc(27, 0x00);
            const body = Buffer.concat([head, fixed, tail]);
            return this._send(body, "setStorage");
        }
        return this.status;
    }
}

module.exports = { DishwasherDevice, APPLIANCE_TYPE_DISHWASHER };
