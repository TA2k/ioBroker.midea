"use strict";

const { BaseDevice } = require("./base");
const { addHeader0xAA, calculateChecksum } = require("../packet");

const APPLIANCE_TYPE_GAS_BOILER = 0xE6;

const HEATING_MODES = ["normal_mode", "out_mode", "home_mode", "sleep_mode"];

/**
 * 0xE6 gas combi boiler. midea-local overrides body to drop the body_type
 * prefix entirely and uses a 30-byte fixed body. Query body = [0x01, 0x01, 0x00 * 28].
 */
function buildE6Frame(body, msgType) {
    let cmd = addHeader0xAA(body, {
        msgType,
        protocol: 0x03,
        applianceType: APPLIANCE_TYPE_GAS_BOILER,
    });
    cmd = Buffer.concat([cmd, Buffer.from([calculateChecksum(cmd)])]);
    return cmd;
}

function parseE6Body(body) {
    const out = {};
    if (!body || body.length < 26) return out;
    out.mainPower = (body[2] & 0x04) > 0;
    out.heatingWorking = (body[2] & 0x10) > 0;
    out.bathingWorking = (body[2] & 0x20) > 0;
    out.heatingPower = (body[4] & 0x01) > 0;
    out.minTemperatureBath = body[16];
    out.minTemperatureHeat = body[11];
    out.maxTemperatureBath = body[15];
    out.maxTemperatureHeat = body[10];
    out.heatingTemperature = body[17];
    out.bathingTemperature = body[12];
    out.heatingLeavingTemperature = body[14];
    out.bathingLeavingTemperature = body[8];
    out.coldWaterSingle = (body[25] & 0x01) > 0;
    out.coldWaterDot = (body[25] & 0x02) > 0;
    if (body[4] & 0x08) out.heatingMode = "out_mode";
    else if (body[4] & 0x04) out.heatingMode = "normal_mode";
    else if (body[4] & 0x10) out.heatingMode = "home_mode";
    else if (body[4] & 0x20) out.heatingMode = "sleep_mode";
    else out.heatingMode = "normal_mode";
    return out;
}

class GasBoilerDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_GAS_BOILER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.alloc(30);
        body[0] = 0x01;
        body[1] = 0x01;
        const cmd = buildE6Frame(body, 0x03);
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseE6Body(inner));
    }

    async setStatus(updates = {}) {
        let body;
        if (updates.mainPower !== undefined) {
            body = [updates.mainPower ? 0x01 : 0x02, 0x01];
        } else if (updates.heatingTemperature !== undefined) {
            body = [0x04, 0x13, Number(updates.heatingTemperature) & 0xFF];
        } else if (updates.bathingTemperature !== undefined) {
            body = [0x04, 0x12, Number(updates.bathingTemperature) & 0xFF];
        } else if (updates.heatingPower !== undefined) {
            body = [0x04, 0x01, updates.heatingPower ? 0x01 : 0x02];
        } else if (updates.coldWaterSingle !== undefined) {
            body = [0x04, 0x1A, updates.coldWaterSingle ? 0x01 : 0x00];
        } else if (updates.coldWaterDot !== undefined) {
            body = [0x04, 0x1B, updates.coldWaterDot ? 0x01 : 0x00];
        } else if (updates.heatingMode !== undefined) {
            const idx = HEATING_MODES.indexOf(updates.heatingMode);
            if (idx < 0) throw new Error(`E6[${this.id}]: invalid heatingMode '${updates.heatingMode}'`);
            const bits = [0x01, 0x02, 0x04, 0x08];
            body = [0x04, 0x02, bits[idx]];
        } else {
            return this.status;
        }
        const padded = Buffer.alloc(30);
        Buffer.from(body).copy(padded);
        const cmd = buildE6Frame(padded, 0x02);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { GasBoilerDevice, APPLIANCE_TYPE_GAS_BOILER, GAS_BOILER_HEATING_MODES: HEATING_MODES };
