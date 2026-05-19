"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_SMART_TOILET = 0xC2;

const KEY_SENSOR_LIGHT = 0x01;
const KEY_WATER_TEMP = 0x09;
const KEY_SEAT_TEMP = 0x0A;
const KEY_DRY = 0x0C;
const KEY_CHILD_LOCK = 0x10;
const KEY_FOAM = 0x1F;

function parseC2Body(body) {
    const out = {};
    if (!body || body.length < 20) return out;
    out.powerOn = (body[2] & 0x01) > 0;
    out.seatStatus = (body[3] & 0x01) > 0;
    out.dryLevel = (body[6] & 0x7E) >> 1;
    out.waterTempLevel = body[9] & 0x07;
    out.seatTempLevel = (body[9] & 0x38) >> 3;
    out.lidStatus = (body[12] & 0x40) > 0;
    out.foamShield = (body[13] & 0x80) > 0;
    out.sensorLight = (body[14] & 0x01) > 0;
    out.lightStatus = (body[14] & 0x02) > 0;
    out.childLock = (body[14] & 0x04) > 0;
    out.waterTemperature = body[11];
    out.filterLife = 100 - body[19];
    return out;
}

class SmartToiletDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_SMART_TOILET; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x01, 0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_SMART_TOILET, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseC2Body(inner));
        return this.status;
    }

    async _send(body, label) {
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_SMART_TOILET, addCrc: false,
        });
        const reply = await this._request(cmd, label);
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseC2Body(inner));
        } catch (err) {
            this.log.debug(`C2[${this.id}]: ${label} reply parse skipped (${err.message})`);
        }
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const bt = updates.powerOn ? 0x01 : 0x02;
            return this._send(Buffer.from([bt, 0x01]), "setPower");
        }
        if (updates.childLock !== undefined) {
            return this._send(Buffer.from([0x14, KEY_CHILD_LOCK, updates.childLock ? 0x10 : 0x00]), "setChildLock");
        }
        if (updates.sensorLight !== undefined) {
            return this._send(Buffer.from([0x14, KEY_SENSOR_LIGHT, updates.sensorLight ? 0x02 : 0x00]), "setSensorLight");
        }
        if (updates.foamShield !== undefined) {
            return this._send(Buffer.from([0x14, KEY_FOAM, updates.foamShield ? 0x04 : 0x00]), "setFoamShield");
        }
        if (updates.dryLevel !== undefined) {
            const v = Number(updates.dryLevel) & 0x03;
            return this._send(Buffer.from([0x14, KEY_DRY, v << 1]), "setDryLevel");
        }
        if (updates.seatTempLevel !== undefined) {
            const v = Number(updates.seatTempLevel) & 0x07;
            return this._send(Buffer.from([0x14, KEY_SEAT_TEMP, v << 3]), "setSeatTemp");
        }
        if (updates.waterTempLevel !== undefined) {
            const v = Number(updates.waterTempLevel) & 0x07;
            return this._send(Buffer.from([0x14, KEY_WATER_TEMP, v]), "setWaterTemp");
        }
        return this.status;
    }
}

module.exports = { SmartToiletDevice, APPLIANCE_TYPE_SMART_TOILET };
