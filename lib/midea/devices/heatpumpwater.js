"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_HEAT_PUMP_WATER = 0xCD;

const MODES_BY_INDEX = { 0: "off", 1: "energy", 2: "standard", 3: "hot", 4: "smart", 5: "vacation" };
const MODES_BY_NAME = { off: 0, energy: 1, standard: 2, hot: 3, smart: 4, vacation: 5 };

/**
 * 0xCD heat-pump water heater. Layout from midea-local devices/cd/message.py.
 * Query: body_type=0x01, _body=[0x01], msg_type=0x03, no inner CRC.
 * Set:   body_type=0x01, _body=[0x01, power, mode, target, ...], msg_type=0x02.
 */
function parseCDBody(body) {
    if (!body || body.length < 30) return {};
    const out = {};
    out.powerOn = (body[2] & 0x01) > 0;
    let mode = 0;
    if ((body[2] & 0x02) > 0) mode = 1;
    else if ((body[2] & 0x04) > 0) mode = 2;
    else if ((body[2] & 0x08) > 0) mode = 3;
    out.heat = (body[2] & 0x10) > 0;
    out.dualHeat = (body[2] & 0x20) > 0;
    out.eco = (body[2] & 0x40) > 0;
    out.targetTemperature = body[3];
    out.currentTemperature = body[4];
    out.topTemperature = body[5];
    out.bottomTemperature = body[6];
    out.condenserTemperature = body[7];
    out.outdoorTemperature = body[8];
    out.compressorTemperature = body[9];
    out.maxTemperature = body[10];
    out.minTemperature = body[11];
    out.errorCode = body[20];
    out.bottomElectricHeat = (body[27] & 0x01) > 0;
    out.topElectricHeat = (body[27] & 0x02) > 0;
    out.waterPump = (body[27] & 0x04) > 0;
    out.compressor = (body[27] & 0x08) > 0;
    if ((body[27] & 0x10) > 0) out.windLevel = "middle";
    else if ((body[27] & 0x40) > 0) out.windLevel = "low";
    else if ((body[27] & 0x80) > 0) out.windLevel = "high";
    out.fourWayValve = (body[27] & 0x20) > 0;
    out.electricHeatSupport = (body[28] & 0x01) > 0;
    const smartFlag = (body[28] & 0x20) > 0;
    if (smartFlag) mode = 4;
    out.backWater = (body[28] & 0x40) > 0;
    out.sterilize = (body[28] & 0x80) > 0;
    out.typeinfo = body[29];
    if (!smartFlag && mode === 0 && body[29] === 0x04) mode = 4;
    if (body.length > 25) {
        if ((body[25] & 0x01) > 0) {
            mode = 5;
            out.vacationMode = true;
            if (body.length > 27) out.vacationDays = (body[26] << 8) | body[27];
        } else {
            out.vacationMode = false;
        }
        out.smartGrid = (body[25] & 0x02) > 0;
        out.multiTerminal = (body[25] & 0x40) > 0;
        out.fahrenheit = (body[25] & 0x80) > 0;
    }
    if (body.length > 35) {
        out.muteEffect = (body[39] & 0x40) > 0;
        out.muteStatus = (body[39] & 0x80) > 0;
    }
    // disinfect: tail marker 0x3c + plausible Celsius (25..90), then on/off flag
    out.disinfect = false;
    out.disinfectionSetTemperature = null;
    for (let i = body.length - 2; i >= Math.max(body.length - 10, 0); i--) {
        if (body[i] === 0x3C) {
            const val = body[i + 1];
            if (val >= 25 && val <= 90) {
                out.disinfectionSetTemperature = val;
                if (i + 2 < body.length) {
                    const tail = body[i + 2];
                    if (tail === 0x00 || tail === 0x01) out.disinfect = tail === 0x01;
                }
                break;
            }
        }
    }
    out.modeIndex = mode;
    out.mode = MODES_BY_INDEX[mode] || "unknown";
    out.waterLevel = body.length > 34 ? body[34] : null;
    return out;
}

class HeatPumpWaterHeaterDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.subtype = Number(opts.applianceSubType || opts.subtype || 0);
        this.useOldProtocol = true;
    }

    get applianceType() { return APPLIANCE_TYPE_HEAT_PUMP_WATER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.from([0x01, 0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_WATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseCDBody(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        const cur = this.status || {};
        const fld = (k) => updates[k] !== undefined ? updates[k] : cur[k];
        const power = updates.powerOn !== undefined ? (updates.powerOn ? 1 : 0) : (this.status.powerOn ? 1 : 0);
        let mode = this.status.modeIndex !== undefined ? this.status.modeIndex : 2;
        if (updates.mode !== undefined) {
            mode = typeof updates.mode === "string" ? MODES_BY_NAME[updates.mode] : Number(updates.mode);
            if (mode === undefined || mode < 0) throw new Error(`CD[${this.id}]: invalid mode '${updates.mode}'`);
        }
        let target = updates.targetTemperature !== undefined
            ? Number(updates.targetTemperature)
            : (this.status.targetTemperature || 50);
        if (this.useOldProtocol) target = Math.round(target * 2 + 30);
        const trValue = Number(fld("trValue") || 0) & 0xFF;
        const openPTC = Number(fld("openPTC") || 0) & 0xFF;
        const ptcTemp = Number(fld("ptcTemp") || 0) & 0xFF;
        const flagByte8 = Number(fld("byte8") || 0) & 0xFF;
        const body = Buffer.from([
            0x01, // body_type
            0x01,
            power & 0xFF,
            mode & 0xFF,
            target & 0xFF,
            trValue, openPTC, ptcTemp, flagByte8,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_WATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseCDBody(inner));
        } catch (err) {
            this.log.debug(`CD[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { HeatPumpWaterHeaterDevice, APPLIANCE_TYPE_HEAT_PUMP_WATER };
