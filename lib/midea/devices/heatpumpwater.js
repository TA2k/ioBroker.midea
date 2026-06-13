"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_HEAT_PUMP_WATER = 0xCD;

const MODES_BY_INDEX = { 0: "off", 1: "energy", 2: "standard", 3: "hot", 4: "smart", 5: "vacation" };
const MODES_BY_NAME = { off: 0, energy: 1, standard: 2, hot: 3, smart: 4, vacation: 5 };

// Models known to ship in Fahrenheit / use the legacy "* 2 + 30" target
// encoding even when reporting via the newer protocol layout. midea-local
// commit 7ff2b3f adds these to the F→C / old-protocol path because the
// device firmware lies about the unit.
const FAHRENHEIT_OUTDOOR_MODELS = new Set(["RSJRAC06", "RSJRAC07"]);
const OLD_PROTOCOL_CURRENT_MODELS = new Set(["RSJRAC06", "RSJRAC07"]);

function fahrenheitToCelsius(f) { return Math.round(((f - 32) * 5) / 9); }
function oldProtocolDecode(v) { return Math.round((v - 30) / 2); }

/**
 * 0xCD heat-pump water heater. Layout from midea-local devices/cd/message.py.
 * Query: body_type=0x01, _body=[0x01], msg_type=0x03, no inner CRC.
 * Set:   body_type=0x01, _body=[0x01, power, mode, target, ...], msg_type=0x02.
 *
 * @param {Buffer} body — decoded inner frame
 * @param {string} [model] — discovery-reported model (e.g. "RSJRAC06") to
 *                          steer the F/C decode for known-quirky firmwares.
 */
function parseCDBody(body, model = "") {
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

    // Per midea-local commit 7ff2b3f: some models (RSJRAC06/07) report the
    // outdoor temperature in Fahrenheit even when the protocol is "new",
    // and the indoor (current) temperature in the legacy "* 2 + 30" format.
    const forceF_outdoor = FAHRENHEIT_OUTDOOR_MODELS.has(model);
    const forceOld_current = OLD_PROTOCOL_CURRENT_MODELS.has(model);

    out.targetTemperature = body[3];
    out.currentTemperature = forceOld_current ? oldProtocolDecode(body[4]) : body[4];
    out.topTemperature = body[5];
    out.bottomTemperature = body[6];
    out.condenserTemperature = body[7];
    out.outdoorTemperature = forceF_outdoor ? fahrenheitToCelsius(body[8]) : body[8];
    out.compressorTemperature = body[9];
    out.maxTemperature = body[10];
    out.minTemperature = body[11];

    // Defensive: zero/negative temperatures during boot before the device
    // populates its sensors mean "not yet known", not "0 °C". Drop them so
    // the previous good value isn't overwritten with a phantom reading.
    for (const k of ["targetTemperature", "currentTemperature", "maxTemperature", "minTemperature"]) {
        if (out[k] !== undefined && out[k] <= 0) delete out[k];
    }
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
        this.model = String(opts.model || "");
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
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseCDBody(inner, this.model));
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
        // Build byte8 from the three flags the Lua app actually writes
        // (midea-local message.py:188 fb30bd6): vacation 0x10, fahrenheit
        // 0x80, mute 0x08. Other bits stay 0; preserve the caller-supplied
        // mute bit if any.
        const vacation = updates.vacationMode !== undefined ? Boolean(updates.vacationMode) : Boolean(cur.vacationMode);
        const fahrenheit = updates.fahrenheit !== undefined ? Boolean(updates.fahrenheit) : Boolean(cur.fahrenheit);
        const muteBit = Number(fld("byte8") || 0) & 0x08;
        let byte8 = muteBit;
        if (vacation) byte8 |= 0x10;
        if (fahrenheit) byte8 |= 0x80;
        // vacationDays default 100 when entering vacation mode and the
        // caller didn't specify one (matches midea-local
        // DEFAULT_VACATION_DAYS).
        const vacationDays = updates.vacationDays !== undefined
            ? Math.max(0, Math.min(0xFFFF, Number(updates.vacationDays) || 0))
            : (vacation ? (Number(cur.vacationDays) || 100) : 0);
        const maxTemp = updates.maxTemperature !== undefined
            ? Math.round(Number(updates.maxTemperature)) & 0xFF
            : (Number(cur.maxTemperature) || 0) & 0xFF;
        const body = Buffer.from([
            0x01, // body_type
            0x01,
            power & 0xFF,
            mode & 0xFF,
            target & 0xFF,
            trValue, openPTC, ptcTemp, byte8,
            (vacationDays >> 8) & 0xFF,
            vacationDays & 0xFF,
            // bytes [11..20]: date/time + vacation-start fields,
            // sent as zero per Lua/midea-local.
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            maxTemp,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_WATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    /**
     * Set the auto-sterilize schedule (controlType=0x06). Mirrors the Lua
     * jsonToData controlType=0x06 layout (midea-local message.py:236
     * fb30bd6). Note that the manual "start sterilize now" payload is not
     * yet known — calling this with `enable: true` controls the *auto*
     * sterilize timer, not an immediate disinfect cycle.
     *
     * @param {object} updates
     * @param {boolean} [updates.enable]
     * @param {number} [updates.weekday] 0..6
     * @param {number} [updates.hour] 0..23
     * @param {number} [updates.minute] 0..59
     */
    async setSterilize(updates = {}) {
        const enable = updates.enable !== undefined ? Boolean(updates.enable) : Boolean(this.status.sterilize);
        const weekday = Math.max(0, Math.min(6, Number(updates.weekday) || 0));
        const hour = Math.max(0, Math.min(23, Number(updates.hour) || 0));
        const minute = Math.max(0, Math.min(59, Number(updates.minute) || 0));
        const body = Buffer.from([
            0x06, // body_type
            0x01,
            enable ? 0x80 : 0x00,
            weekday & 0xFF,
            hour & 0xFF,
            minute & 0xFF,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_WATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setSterilize");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { HeatPumpWaterHeaterDevice, APPLIANCE_TYPE_HEAT_PUMP_WATER };
