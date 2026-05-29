"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_DISHWASHER = 0xE1;

// Status-byte → human-readable label, mirrored from midea-local's
// MideaE1Device._status (devices/e1/__init__.py).
const STATUS_BY_CODE = {
    0x00: "Power Off",
    0x01: "Cancel",
    0x02: "Delay",
    0x03: "Running",
    0x04: "Error",
    0x05: "Soft Gear",
};

// Mode-byte → human-readable label, mirrored from midea-local's
// MideaE1Device._modes.
const MODE_BY_CODE = {
    0x00: "Neutral Gear",
    0x01: "Auto Wash",
    0x02: "Strong Wash",
    0x03: "Standard Wash",
    0x04: "ECO Wash",
    0x05: "Glass Wash",
    0x06: "Hour Wash",
    0x07: "Fast Wash",
    0x08: "Soak Wash",
    0x09: "90Min",
    0x0A: "Self Clean",
    0x0B: "Fruit Wash",
    0x0C: "Self Define",
    0x0D: "Germ",
    0x0E: "Bowl Wash",
    0x0F: "Kill Germ",
    0x10: "Sea Food Wash",
    0x12: "Hot Pot Wash",
    0x13: "Quiet Night Wash",
    0x14: "Less Wash",
    0x16: "Oil Net Wash",
    0x19: "Cloud Wash",
};

// Wash-progress index → label.
const PROGRESS_BY_INDEX = ["Idle", "Pre-wash", "Wash", "Rinse", "Dry", "Complete"];

function parseE1Body(body) {
    const out = {};
    if (!body || body.length < 12) return out;
    out.powerOn = body[1] > 0;
    out.statusCode = body[1];
    out.statusName = STATUS_BY_CODE[body[1]] || "unknown";
    out.mode = body[2];
    out.modeName = MODE_BY_CODE[body[2]] || "unknown";
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
    out.progressName = body[9] < PROGRESS_BY_INDEX.length ? PROGRESS_BY_INDEX[body[9]] : "unknown";
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
