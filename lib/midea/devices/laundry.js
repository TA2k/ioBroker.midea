"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_TOP_LOAD_WASHER = 0xDA;
const APPLIANCE_TYPE_FRONT_LOAD_WASHER = 0xDB;
const APPLIANCE_TYPE_DRYER = 0xDC;

/**
 * Top-load washer (DA), front-load washer (DB) and dryer (DC) share the
 * same query/start/power layout (body_type 0x03 query, 0x02 set). Status
 * fields differ slightly so we have one parser per type.
 */
function parseDABody(body) {
    const out = {};
    if (!body || body.length < 19) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.errorCode = body[24];
    out.program = body[4];
    out.washingData = Array.from(body.subarray(3, 15));
    out.washTime = body[9];
    out.soakTime = body[12];
    out.dehydrationTime = (body[10] & 0xF0) >> 4;
    out.dehydrationSpeed = (body[6] & 0xF0) >> 4;
    out.rinseCount = body[10] & 0x0F;
    out.rinseLevel = (body[5] & 0xF0) >> 4;
    out.washLevel = body[5] & 0x0F;
    out.washStrength = body[6] & 0x0F;
    out.softener = (body[8] & 0xF0) >> 4;
    out.detergent = body[8] & 0x0F;
    let progress = 0;
    for (let i = 1; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i; break; }
    }
    out.progress = progress;
    if (out.powerOn) out.timeRemaining = body[17] + body[18] * 60;
    return out;
}

function parseDBBody(body) {
    const out = {};
    if (!body || body.length < 31) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.statusCode = body[2];
    out.mode = body[3];
    out.program = body[4];
    out.waterLevel = body[5];
    out.temperature = body[7];
    out.dehydrationSpeed = body[8];
    out.washTime = body[9];
    out.dehydrationTime = body[10];
    out.detergent = body[11];
    out.softener = body[12];
    let progress = 0;
    for (let i = 0; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i + 1; break; }
    }
    out.progress = progress;
    out.stains = body[26];
    out.washTimeValue = body[27];
    out.dehydrationTimeValue = body[28];
    out.dirtyDegree = body[30];
    if (out.powerOn) out.timeRemaining = body[17] + (body[18] << 8);
    return out;
}

function parseDCBody(body) {
    const out = {};
    if (!body || body.length < 30) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.statusCode = body[2];
    out.program = body[4];
    out.washingData = Array.from(body.subarray(3, 15));
    out.intensity = body[9];
    out.drynessLevel = body[10];
    out.dryTemperature = body[10];
    out.errorCode = body[24];
    out.doorWarn = body[25];
    out.aiSwitch = body[27];
    out.material = body[28];
    out.waterBox = body[29];
    let progress = 0;
    for (let i = 0; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i + 1; break; }
    }
    out.progress = progress;
    if (out.powerOn) out.timeRemaining = body[17] + body[18] * 60;
    return out;
}

class _LaundryBase extends BaseDevice {
    async refreshCapabilities() { return null; }

    /** @param {Buffer} _b */
    _parse(_b) { return {}; }

    async refreshStatus() {
        const body = Buffer.from([0x03]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: this.applianceType,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(this._parse(inner));
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const tail = this.applianceType === APPLIANCE_TYPE_FRONT_LOAD_WASHER
                ? Buffer.alloc(20, 0xFF)
                : Buffer.from([0xFF]);
            const body = Buffer.concat([Buffer.from([0x02, updates.powerOn ? 0x01 : 0x00]), tail]);
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: this.applianceType,
                addCrc: false,
            });
            await this._request(cmd, "setPower");
            this.status.powerOn = !!updates.powerOn;
            return this.status;
        }
        if (updates.start !== undefined) {
            const head = updates.start ? Buffer.from([0x02, 0xFF, 0x01]) : Buffer.from([0x02, 0xFF, 0x00]);
            const body = updates.start && this.status.washingData
                ? Buffer.concat([head, Buffer.from(this.status.washingData || [])])
                : head;
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: this.applianceType,
                addCrc: false,
            });
            await this._request(cmd, "setStart");
            return this.status;
        }
        return this.status;
    }
}

class TopLoadWasherDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_TOP_LOAD_WASHER; }
    _parse(b) { return parseDABody(b); }
}

class FrontLoadWasherDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_FRONT_LOAD_WASHER; }
    _parse(b) { return parseDBBody(b); }
}

class DryerDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_DRYER; }
    _parse(b) { return parseDCBody(b); }
}

module.exports = {
    TopLoadWasherDevice, APPLIANCE_TYPE_TOP_LOAD_WASHER,
    FrontLoadWasherDevice, APPLIANCE_TYPE_FRONT_LOAD_WASHER,
    DryerDevice, APPLIANCE_TYPE_DRYER,
};
