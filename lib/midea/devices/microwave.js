"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_MICROWAVE = 0xB0;

function parseB0Default(body) {
    const out = {};
    if (!body || body.length < 16) return out;
    out.door = (body[1] & 0x80) > 0;
    out.statusCode = body[1] & 0x7F;
    out.mode = body[2];
    out.timeRemaining = body[3] * 60 + body[4];
    out.workStage = body[5];
    out.errorCode = body[6];
    out.tipsCode = body[7];
    out.maintain = body[8];
    out.firePower = body[15];
    return out;
}

function parseB0_01(body) {
    const out = {};
    if (!body || body.length < 33) return out;
    out.door = (body[33] & 0x02) > 0;
    out.statusCode = body[32];
    const h = body[23] === 0xFF ? 0 : body[23];
    const m = body[24] === 0xFF ? 0 : body[24];
    const s = body[25] === 0xFF ? 0 : body[25];
    out.timeRemaining = h * 3600 + m * 60 + s;
    let temp = (body[26] << 8) + body[27];
    if (temp === 0) temp = (body[28] << 8) + body[29];
    out.currentTemperature = temp;
    out.tankEjected = (body[33] & 0x04) > 0;
    out.waterShortage = (body[33] & 0x08) > 0;
    out.waterChangeReminder = (body[33] & 0x10) > 0;
    return out;
}

function parseB0_31(body) {
    const out = {};
    if (!body || body.length < 17) return out;
    out.statusCode = body[1];
    out.cloudMenuId = body[2] * 65536 + body[3] * 256 + body[4];
    out.stepNum = body[5];
    out.timeRemaining = (body[6] === 0xFF ? 0 : body[6]) * 3600
        + (body[7] === 0xFF ? 0 : body[7]) * 60
        + (body[8] === 0xFF ? 0 : body[8]);
    out.mode = body[9];
    if (body[11] > 0 && body[11] < 0xFF) out.currentTemperature = body[11];
    if (body[13] > 0 && body[13] < 0xFF) out.currentTemperature = body[13];
    out.firePower = body[14];
    out.weight = body[15] === 0xFF ? 0 : body[15] * 10;
    out.childLock = (body[16] & 0x01) > 0;
    out.door = (body[16] & 0x02) > 0;
    out.tankEjected = (body[16] & 0x04) > 0;
    out.waterShortage = (body[16] & 0x08) > 0;
    out.waterChangeReminder = (body[16] & 0x10) > 0;
    return out;
}

function parseB0(body, bodyType) {
    if (bodyType === 0x01) return parseB0_01(body);
    if (bodyType === 0x31 || bodyType === 0x41) return parseB0_31(body);
    return parseB0Default(body);
}

class MicrowaveDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_MICROWAVE; }

    async refreshCapabilities() { return null; }

    async _query(bodyType) {
        const cmd = createCommand(Buffer.from([bodyType]), {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_MICROWAVE,
            addCrc: false,
        });
        const reply = await this._request(cmd, `getStatus_${bodyType.toString(16)}`);
        const inner = reply.subarray(10, reply.length - 1);
        return parseB0(inner, inner[0]);
    }

    async refreshStatus() {
        for (const bt of [0x00, 0x01, 0x31]) {
            try {
                const parsed = await this._query(bt);
                this._mergeStatus(parsed);
            } catch (err) {
                this.log.debug(`B0[${this.id}]: query ${bt.toString(16)} failed (${err.message})`);
            }
        }
        return this.status;
    }

    async _send(body, label) {
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_MICROWAVE,
            addCrc: false,
        });
        const reply = await this._request(cmd, label);
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseB0(inner, inner[0]));
        } catch (err) {
            this.log.debug(`B0[${this.id}]: ${label} reply parse skipped (${err.message})`);
        }
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.workMode !== undefined) {
            const mode = Number(updates.workMode) & 0xFF;
            const firePower = updates.firePower !== undefined ? Number(updates.firePower) & 0xFF : 0xFF;
            const wt = updates.workTime !== undefined ? Number(updates.workTime) : 60;
            const temp = updates.temperature !== undefined ? Number(updates.temperature) : 0;
            const h = Math.max(0, Math.floor(wt / 3600));
            const m = Math.max(0, Math.floor((wt % 3600) / 60));
            const s = Math.max(0, wt % 60);
            const tH = temp > 0 ? Math.floor(temp / 256) : 0;
            const tL = temp > 0 ? temp % 256 : 0;
            const body = Buffer.from([
                0x22, 0x01, 0x00, 0x00, 0x00, 0x11, 0x00,
                h, m, s, mode, tH, tL, tH, tL, firePower, 0xFF, 0xFF, 0x00,
            ]);
            return this._send(body, "setWorkMode");
        }
        if (updates.powerOn !== undefined || updates.childLock !== undefined || updates.door !== undefined) {
            const status = updates.powerOn === undefined ? 0xFF : (updates.powerOn ? 0x02 : 0x01);
            const childLock = updates.childLock === undefined ? 0xFF : (updates.childLock ? 0x01 : 0x00);
            const door = updates.door === undefined ? 0xFF : (updates.door ? 0x01 : 0x00);
            const body = Buffer.from([0x22, 0x02, status, childLock, 0xFF, 0xFF, door]);
            return this._send(body, "setNotWorkMode");
        }
        if (updates.timeIncrease !== undefined || updates.temperatureIncrease !== undefined) {
            const ti = Number(updates.timeIncrease || 0);
            const h = Math.floor(ti / 3600);
            const m = Math.floor((ti % 3600) / 60);
            const s = ti % 60;
            const tInc = updates.temperatureIncrease ? Number(updates.temperatureIncrease) : 0xFF;
            const body = Buffer.from([
                0x22, 0x03, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                h, m, s, 0xFF, 0xFF, tInc, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            ]);
            return this._send(body, "setIncrease");
        }
        if (updates.workTime !== undefined || updates.temperature !== undefined || updates.firePower !== undefined) {
            const wt = Number(updates.workTime || 0);
            const h = wt > 0 ? Math.floor(wt / 3600) : 0xFF;
            const m = wt > 0 ? Math.floor((wt % 3600) / 60) : 0xFF;
            const s = wt > 0 ? wt % 60 : 0xFF;
            const t = Number(updates.temperature || 0);
            const tEnable = t ? 0x00 : 0xFF;
            const tSet = t ? t & 0xFF : 0xFF;
            const fp = updates.firePower !== undefined ? Number(updates.firePower) & 0xFF : 0xFF;
            const body = Buffer.from([
                0x22, 0x04, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                h, m, s, 0xFF, tEnable, tSet, 0xFF, 0xFF, fp, 0xFF, 0xFF, 0xFF,
            ]);
            return this._send(body, "setControl");
        }
        return this.status;
    }
}

module.exports = { MicrowaveDevice, APPLIANCE_TYPE_MICROWAVE };
