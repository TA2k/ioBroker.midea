"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_ELECTRIC_WATER_HEATER = 0xE2;

/**
 * 0xE2 electric water heater. Layout from midea-local devices/e2/message.py.
 * Uses old protocol (body_type 0x04) by default; subtype-driven branches not
 * exposed here. Power on/off uses body_type 0x01 (on) / 0x02 (off).
 */
function parseE2Body(body) {
    if (!body || body.length < 17) return {};
    const out = {};
    out.powerOn = (body[2] & 0x01) > 0;
    out.fastHotPower = (body[2] & 0x02) > 0;
    out.heating = (body[2] & 0x04) > 0;
    out.keepWarm = (body[2] & 0x08) > 0;
    out.waterFlow = (body[2] & 0x10) > 0;
    out.sterilization = (body[2] & 0x40) > 0;
    out.variableHeating = (body[2] & 0x80) > 0;
    out.currentTemperature = body[4];
    out.heatWaterLevel = body[5];
    out.eplus = (body[7] & 0x01) > 0;
    out.fastWash = (body[7] & 0x02) > 0;
    out.halfHeat = (body[7] & 0x04) > 0;
    out.wholeTankHeating = (body[7] & 0x08) > 0;
    out.summer = (body[7] & 0x10) > 0;
    out.winter = (body[7] & 0x20) > 0;
    out.efficient = (body[7] & 0x40) > 0;
    out.night = (body[7] & 0x80) > 0;
    out.screenOff = (body[8] & 0x08) > 0;
    out.sleep = (body[8] & 0x10) > 0;
    out.cloud = (body[8] & 0x20) > 0;
    out.appointWash = (body[8] & 0x40) > 0;
    out.nowWash = (body[8] & 0x80) > 0;
    out.heatingTimeRemaining = body[9] * 60 + body[10];
    out.targetTemperature = body[11];
    out.smartSterilize = (body[12] & 0x20) > 0;
    out.sterilizeHighTemp = (body[12] & 0x40) > 0;
    out.uvSterilize = (body[12] & 0x80) > 0;
    out.discharge = body[13];
    out.topTemperature = body[14];
    out.bottomHeat = (body[15] & 0x01) > 0;
    out.topHeat = (body[15] & 0x02) > 0;
    out.waterCyclic = (body[15] & 0x80) > 0;
    out.waterSystem = body[16];
    if (body.length > 22) out.inTemperature = body[18];
    if (body.length > 22) out.protection = (body[22] & 0x02) > 0;
    if (body.length > 25) {
        out.dayWaterConsumption = body[20] + (body[21] << 8);
        out.waterConsumption = body[24] + (body[25] << 8);
    }
    if (body.length > 34) {
        out.volume = body[27];
        out.rate = body[28] * 100;
        out.heatingPower = body[34] * 100;
    }
    return out;
}

class ElectricWaterHeaterDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_ELECTRIC_WATER_HEATER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.from([0x01, 0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseE2Body(inner));
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            // power-only: body_type 0x01 (on) or 0x02 (off), body=[body_type, 0x01]
            const bodyType = updates.powerOn ? 0x01 : 0x02;
            const body = Buffer.from([bodyType, 0x01]);
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
                addCrc: false,
            });
            await this._request(cmd, "setPower");
            this.status.powerOn = !!updates.powerOn;
            return this.status;
        }

        // New-protocol single-property set (body_type 0x14, two bytes [tag, value])
        // Maps directly to MessageNewProtocolSet in midea-local e2/message.py.
        const newProto = {
            targetTemperature: (v) => [0x07, Number(v) & 0xFF],
            wholeTankHeating: (v) => [0x04, v ? 0x02 : 0x01],
            variableHeating: (v) => [0x10, v ? 0x01 : 0x00],
            sterilization: (v) => [0x0D, v ? 0x01 : 0x00],
            protect: (v) => [0x05, v ? 0x01 : 0x00],
            sleep: (v) => [0x0E, v ? 0x01 : 0x00],
            bigWater: (v) => [0x11, v ? 0x01 : 0x00],
            autoOff: (v) => [0x14, v ? 0x01 : 0x00],
            safe: (v) => [0x06, v ? 0x01 : 0x00],
            screenOff: (v) => [0x0F, v ? 0x01 : 0x00],
            washTemperature: (v) => [0x16, Number(v) & 0xFF],
            smartSterilize: (v) => [0x1B, v ? 0x01 : 0x00],
            uvSterilize: (v) => [0x1D, v ? 0x01 : 0x00],
        };
        for (const key of Object.keys(newProto)) {
            if (updates[key] !== undefined) {
                const [tag, val] = newProto[key](updates[key]);
                const body = Buffer.from([0x14, tag, val]);
                const cmd = createCommand(body, {
                    msgType: 0x02,
                    protocol: 0x03,
                    applianceType: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
                    addCrc: false,
                });
                this.log.debug(`E2[${this.id}]: setNewProto ${key}=${updates[key]} -> tag=0x${tag.toString(16)}`);
                const reply = await this._request(cmd, `setE2New_${key}`);
                this._processFrame(reply, { source: "set", msgType: reply[9] });
                return this.status;
            }
        }

        // Standard set (body_type 0x04, 19 bytes)
        const cur = this.status || {};
        const fld = (k) => updates[k] !== undefined ? updates[k] : cur[k];
        const protection = fld("protection") ? 0x04 : 0x00;
        const wholeTank = fld("wholeTankHeating") ? 0x02 : 0x01;
        const target = updates.targetTemperature !== undefined
            ? Number(updates.targetTemperature) & 0xFF
            : (cur.targetTemperature || 50) & 0xFF;
        const variable = fld("variableHeating") ? 0x10 : 0x00;
        const body = Buffer.from([
            0x04, // body_type
            0x01, 0x00, 0x80,
            wholeTank | protection,
            target,
            0, 0, 0,
            variable,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { ElectricWaterHeaterDevice, APPLIANCE_TYPE_ELECTRIC_WATER_HEATER };
