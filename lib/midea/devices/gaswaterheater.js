"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_GAS_WATER_HEATER = 0xE3;

function parseE3Body(body) {
    if (!body || body.length < 9) return {};
    const out = {};
    out.powerOn = (body[2] & 0x01) > 0;
    out.burning = (body[2] & 0x02) > 0;
    out.zeroColdWater = (body[2] & 0x04) > 0;
    out.currentTemperature = body[5];
    out.targetTemperature = body[6];
    out.protection = (body[8] & 0x08) > 0;
    if (body.length > 20) {
        out.zeroColdPulse = (body[20] & 0x01) > 0;
        out.smartVolume = (body[20] & 0x02) > 0;
    }
    return out;
}

class GasWaterHeaterDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_GAS_WATER_HEATER; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.from([0x01, 0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_GAS_WATER_HEATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseE3Body(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const bodyType = updates.powerOn ? 0x01 : 0x02;
            const body = Buffer.from([bodyType, 0x01]);
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: APPLIANCE_TYPE_GAS_WATER_HEATER,
                addCrc: false,
            });
            await this._request(cmd, "setPower");
            this.status.powerOn = !!updates.powerOn;
            return this.status;
        }

        // Standard set (body_type 0x04)
        const zeroCold = updates.zeroColdWater ? 0x01 : 0x00;
        const protection = updates.protection ? 0x08 : 0x00;
        const zeroColdPulse = updates.zeroColdPulse ? 0x10 : 0x00;
        const smartVolume = updates.smartVolume ? 0x20 : 0x00;
        const target = updates.targetTemperature !== undefined
            ? Number(updates.targetTemperature) & 0xFF
            : (this.status.targetTemperature || 40) & 0xFF;
        const body = Buffer.from([
            0x04,
            0x01,
            zeroCold | 0x02,
            protection | zeroColdPulse | smartVolume,
            0x00,
            target,
            0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_GAS_WATER_HEATER,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseE3Body(inner));
        } catch (err) {
            this.log.debug(`E3[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { GasWaterHeaterDevice, APPLIANCE_TYPE_GAS_WATER_HEATER };
