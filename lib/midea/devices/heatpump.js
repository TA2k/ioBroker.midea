"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_HEATPUMP = 0xCF;

const MODES = ["off", "auto", "cool", "heat"];

/**
 * 0xCF heat pump (heating only / cool+heat). Layout taken from
 * midea-local devices/cf/message.py:
 *   - Query: body_type=0x01, empty _body, msg_type=0x03, no inner CRC.
 *   - Set:   body_type=0x01, 4-byte body [power, mode, target, aux], msg_type=0x02.
 *   - Response: data_offset=1 for query/set, =0 for notify.
 */
function parseCFBody(body, dataOffset) {
    if (!body || body.length < dataOffset + 6) return {};
    const off = dataOffset;
    const out = {};
    out.powerOn = (body[off + 0] & 0x01) > 0;
    out.auxHeating = (body[off + 0] & 0x02) > 0;
    out.silent = (body[off + 0] & 0x04) > 0;
    out.heatEnable = (body[off + 1] & 0x01) > 0;
    out.coolEnable = (body[off + 1] & 0x02) > 0;
    out.tempInFahrenheit = (body[off + 1] & 0x04) > 0;
    out.roomTempCtrl = (body[off + 1] & 0x08) > 0;
    out.roomTempSet = (body[off + 1] & 0x10) > 0;
    out.compressor = (body[off + 2] & 0x01) > 0;
    out.warning = (body[off + 2] & 0x10) > 0;
    out.defrost = (body[off + 2] & 0x20) > 0;
    out.freeze = (body[off + 2] & 0x40) > 0;
    out.holiday = (body[off + 2] & 0x80) > 0;
    out.modeIndex = body[off + 3];
    out.targetTemperature = body[off + 4];
    out.currentTemperature = body[off + 5];
    if (body.length >= off + 10) {
        if (out.modeIndex === 2) {
            out.maxTemperature = body[off + 8];
            out.minTemperature = body[off + 9];
        } else if (out.modeIndex === 3) {
            out.maxTemperature = body[off + 6];
            out.minTemperature = body[off + 7];
        } else {
            out.maxTemperature = body[off + 6];
            out.minTemperature = body[off + 9];
        }
    }
    return out;
}

class HeatPumpDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_HEATPUMP; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        // body_type=0x01, _body=[]; createCommand prepends body_type via builder is NOT used here:
        // we pass [body_type] + _body directly as the first arg.
        const body = Buffer.from([0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEATPUMP,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, ctx) {
        if (!frame || frame.length < 12) return undefined;
        // Detect notify frames by msgType (0x05) rather than ctx.source: if a
        // push notify races a setStatus round-trip, lan.js may resolve the
        // request promise with the notify frame. ctx.source would then be
        // "set" while msgType from the frame is still 0x05 — keying off the
        // frame's own msgType keeps dataOffset correct in that race.
        const msgType = (ctx && ctx.msgType) != null ? ctx.msgType : frame[9];
        const dataOffset = msgType === 0x05 ? 0 : 1;
        const inner = frame.subarray(10, frame.length - 1);
        const parsed = parseCFBody(inner, dataOffset);
        return this._mergeStatus(this._normalize(parsed));
    }

    async setStatus(updates = {}) {
        const power = updates.powerOn !== undefined ? (updates.powerOn ? 0x01 : 0x00) : (this.status.powerOn ? 0x01 : 0x00);
        let mode;
        if (updates.mode !== undefined) {
            mode = typeof updates.mode === "string" ? MODES.indexOf(updates.mode) : Number(updates.mode);
            if (mode < 0 || mode > 3) throw new Error(`CF[${this.id}]: invalid mode '${updates.mode}'`);
        } else {
            mode = this.status.modeIndex !== undefined ? this.status.modeIndex : 0;
        }
        const target = updates.targetTemperature !== undefined ? Number(updates.targetTemperature) & 0xFF : 0xFF;
        const aux = updates.auxHeating === undefined ? 0xFF : (updates.auxHeating ? 0x01 : 0x00);
        const body = Buffer.from([0x01, power, mode, target, aux]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEATPUMP,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    _normalize(raw) {
        const out = { ...raw };
        if (raw.modeIndex !== undefined) {
            out.mode = MODES[raw.modeIndex] || "unknown";
        }
        return out;
    }
}

module.exports = {
    HeatPumpDevice,
    APPLIANCE_TYPE_HEATPUMP,
    HEATPUMP_MODES: MODES,
};
