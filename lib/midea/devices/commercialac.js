"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_COMMERCIAL_AC = 0xCC;

const MODES_BY_INDEX = { 0: "off", 1: "auto", 2: "cool", 3: "dry", 4: "heat", 5: "fan" };
const MODES_BY_NAME = { off: 0, auto: 1, cool: 2, dry: 3, heat: 4, fan: 5 };

/**
 * 0xCC commercial AC. Layout taken from midea-local devices/cc/message.py.
 * Query: body_type=0x01, msg_type=0x03; Set: body_type=0xC3, msg_type=0x02.
 * Response body_type 0x01 (query/notify) or 0xC3 (set ack) -> CCGeneralMessageBody.
 */
function parseCCBody(body) {
    const out = {};
    if (!body || body.length < 21) return out;
    out.powerOn = (body[1] & 0x80) > 0;
    let modeRaw = body[1] & 0x1F;
    let modeIdx = 0;
    while (modeRaw >= 1) { modeRaw = modeRaw / 2; modeIdx++; }
    out.modeIndex = modeIdx;
    out.mode = MODES_BY_INDEX[modeIdx] || "unknown";
    out.fanSpeed = body[2];
    out.targetTemperature = body[3] + body[19] / 10;
    out.indoorTemperature = (body[4] - 40) / 2;
    out.ecoMode = (body[13] & 0x01) > 0;
    out.autoAuxHeatRunning = (body[13] & 0x02) > 0;
    out.swing = (body[13] & 0x04) > 0;
    out.ventilation = (body[13] & 0x08) > 0;
    out.fanSpeedLevel = (body[13] & 0x40) > 0;
    out.nightLight = (body[14] & 0x08) > 0;
    out.sleepMode = (body[14] & 0x10) > 0;
    out.auxHeatStatus = (body[14] & 0x60) >> 5;
    out.temperaturePrecision = (body[14] & 0x80) > 0 ? 1 : 0.5;
    out.tempFahrenheit = (body[20] & 0x80) > 0;
    return out;
}

class CommercialACDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_COMMERCIAL_AC; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(23, 0x00)]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_COMMERCIAL_AC,
        });
        this.log.debug(`CC[${this.id}]: refreshStatus() -> sending 0x01 query`);
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseCCBody(inner));
    }

    async setStatus(updates = {}) {
        const cur = this.status || {};
        const fld = (k, def) => updates[k] !== undefined ? updates[k] : (cur[k] !== undefined ? cur[k] : def);
        const power = updates.powerOn !== undefined ? !!updates.powerOn : !!cur.powerOn;
        let modeIdx = cur.modeIndex !== undefined ? cur.modeIndex : 4;
        if (updates.mode !== undefined) {
            modeIdx = typeof updates.mode === "string" ? MODES_BY_NAME[updates.mode] : Number(updates.mode);
            if (modeIdx === undefined || modeIdx < 1 || modeIdx > 5) {
                throw new Error(`CC[${this.id}]: invalid mode '${updates.mode}'`);
            }
        }
        if (modeIdx < 1) modeIdx = 4;
        const fanSpeed = Number(fld("fanSpeed", 0x80)) & 0xFF;
        const target = Number(fld("targetTemperature", 26));
        const tInt = Math.floor(target) & 0xFF;
        const tDot = Math.round((target - tInt) * 10) & 0xFF;
        const eco = !!fld("ecoMode", false);
        const ventilation = !!fld("ventilation", false);
        const swing = !!fld("swing", false);
        const sleep = !!fld("sleepMode", false);
        const nightLight = !!fld("nightLight", false);
        const auxHeat = Number(fld("auxHeatStatus", 0)) & 0xFF;
        let auxByte = 0;
        if (auxHeat === 1) auxByte = 0x10;
        else if (auxHeat === 2) auxByte = 0x20;
        const setBody = Buffer.concat([Buffer.from([0xC3]), Buffer.from([
            (power ? 0x80 : 0x00) | (1 << (modeIdx - 1)),
            fanSpeed,
            tInt,
            0x00, 0x00,
            (eco ? 0x01 : 0) | (ventilation ? 0x08 : 0) | (swing ? 0x04 : 0) | auxByte,
            0xFF,
            (sleep ? 0x10 : 0) | (nightLight ? 0x08 : 0),
            0x00, 0x00,
            tDot,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ])]);
        const cmd = createCommand(setBody, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_COMMERCIAL_AC,
        });
        this.log.debug(`CC[${this.id}]: setStatus(${JSON.stringify(updates)}) -> sending 0xC3 frame`);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { CommercialACDevice, APPLIANCE_TYPE_COMMERCIAL_AC };
