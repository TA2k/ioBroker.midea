"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER = 0xC3;

const SILENT_LEVELS = { off: 0x00, super_silent: 0x01, silent: 0x09 };

function parseC3Basic(body, off) {
    const out = {};
    if (!body || body.length < off + 22) return out;
    out.zone1Power = (body[off] & 0x01) > 0;
    out.zone2Power = (body[off] & 0x02) > 0;
    out.dhwPower = (body[off] & 0x04) > 0;
    out.zone1Curve = (body[off] & 0x08) > 0;
    out.zone2Curve = (body[off] & 0x10) > 0;
    out.tbh = (body[off] & 0x20) > 0;
    out.fastDhw = (body[off] & 0x40) > 0;
    out.heat = (body[off + 1] & 0x01) > 0;
    out.cool = (body[off + 1] & 0x02) > 0;
    out.dhw = (body[off + 1] & 0x04) > 0;
    out.doubleZone = (body[off + 1] & 0x08) > 0;
    out.silentMode = (body[off + 2] & 0x02) > 0;
    out.holidayOn = (body[off + 2] & 0x04) > 0;
    out.ecoMode = (body[off + 2] & 0x08) > 0;
    out.mode = body[off + 3];
    out.modeAuto = body[off + 4];
    out.zone1TargetTemp = body[off + 5];
    out.zone2TargetTemp = body[off + 6];
    out.dhwTargetTemp = body[off + 7];
    out.roomTargetTemp = body[off + 8] / 2;
    out.tankActualTemperature = body[off + 21];
    out.errorCode = body[off + 22];
    return out;
}

function parseC3Silence(body, off) {
    const out = {};
    if (!body || body.length < off + 1) return out;
    out.silentMode = (body[off] & 0x01) > 0;
    out.silentLevel = body[off] & 0x09;
    return out;
}

function parseC3Eco(body, off) {
    const out = {};
    if (!body || body.length < off + 1) return out;
    out.ecoMode = (body[off] & 0x01) > 0;
    out.ecoTimer = (body[off] & 0x02) > 0;
    return out;
}

function parseC3Disinfect(body, off) {
    const out = {};
    if (!body || body.length < off + 4) return out;
    out.disinfect = (body[off] & 0x01) > 0;
    out.disinfectRun = (body[off] & 0x02) > 0;
    out.disinfectWeekday = body[off + 1];
    out.disinfectStartHour = body[off + 2];
    out.disinfectStartMin = body[off + 3];
    return out;
}

function parseC3(body) {
    if (!body) return {};
    const bt = body[0];
    if (bt === 0x01) return parseC3Basic(body, 1);
    if (bt === 0x05) return parseC3Silence(body, 1);
    if (bt === 0x07) return parseC3Eco(body, 1);
    if (bt === 0x09) return parseC3Disinfect(body, 1);
    return {};
}

class HeatPumpControllerDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER; }

    async refreshCapabilities() { return null; }

    async _query(bodyType) {
        const cmd = createCommand(Buffer.from([bodyType]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, addCrc: false,
        });
        const reply = await this._request(cmd, `getStatus_${bodyType.toString(16)}`);
        const inner = reply.subarray(10, reply.length - 1);
        return parseC3(inner);
    }

    async refreshStatus() {
        for (const bt of [0x01, 0x05, 0x07, 0x09]) {
            try { this._mergeStatus(await this._query(bt)); }
            catch (err) { this.log.debug(`C3[${this.id}]: query ${bt.toString(16)} failed (${err.message})`); }
        }
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.silentMode !== undefined || updates.silentLevel !== undefined) {
            const lvl = updates.silentMode === false ? 0x00 :
                (updates.silentLevel !== undefined
                    ? (SILENT_LEVELS[updates.silentLevel] !== undefined ? SILENT_LEVELS[updates.silentLevel] : Number(updates.silentLevel))
                    : 0x01);
            const body = Buffer.from([0x05, lvl, 0, 0, 0, 0, 0, 0, 0, 0]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, addCrc: false,
            });
            await this._request(cmd, "setSilent");
            return this.status;
        }
        if (updates.ecoMode !== undefined) {
            const body = Buffer.from([0x07, updates.ecoMode ? 0x01 : 0x00, 0, 0, 0, 0, 0]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, addCrc: false,
            });
            await this._request(cmd, "setEco");
            return this.status;
        }
        if (updates.disinfect !== undefined) {
            const body = Buffer.from([0x09, updates.disinfect ? 0x01 : 0x00, 0, 0, 0]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, addCrc: false,
            });
            await this._request(cmd, "setDisinfect");
            return this.status;
        }
        // Basic set: combined power/mode/temps
        const z1 = updates.zone1Power !== undefined ? !!updates.zone1Power : !!this.status.zone1Power;
        const z2 = updates.zone2Power !== undefined ? !!updates.zone2Power : !!this.status.zone2Power;
        const dhw = updates.dhwPower !== undefined ? !!updates.dhwPower : !!this.status.dhwPower;
        const z1c = updates.zone1Curve !== undefined ? !!updates.zone1Curve : !!this.status.zone1Curve;
        const z2c = updates.zone2Curve !== undefined ? !!updates.zone2Curve : !!this.status.zone2Curve;
        const tbh = updates.tbh !== undefined ? !!updates.tbh : !!this.status.tbh;
        const fastDhw = updates.fastDhw !== undefined ? !!updates.fastDhw : !!this.status.fastDhw;
        const mode = updates.mode !== undefined ? Number(updates.mode) : (this.status.mode || 0);
        const z1Tgt = updates.zone1TargetTemp !== undefined ? Number(updates.zone1TargetTemp) : (this.status.zone1TargetTemp || 25);
        const z2Tgt = updates.zone2TargetTemp !== undefined ? Number(updates.zone2TargetTemp) : (this.status.zone2TargetTemp || 25);
        const dhwTgt = updates.dhwTargetTemp !== undefined ? Number(updates.dhwTargetTemp) : (this.status.dhwTargetTemp || 40);
        const roomTgt = updates.roomTargetTemp !== undefined ? Number(updates.roomTargetTemp) : (this.status.roomTargetTemp || 25);
        const byte1 = (z1 ? 0x01 : 0) | (z2 ? 0x02 : 0) | (dhw ? 0x04 : 0);
        const byte7 = (z1c ? 0x01 : 0) | (z2c ? 0x02 : 0) | (tbh ? 0x04 : 0) | (fastDhw ? 0x08 : 0);
        const body = Buffer.from([
            0x01, byte1, mode & 0xFF, z1Tgt & 0xFF, z2Tgt & 0xFF, dhwTgt & 0xFF,
            Math.round(roomTgt * 2) & 0xFF, byte7,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, addCrc: false,
        });
        const reply = await this._request(cmd, "setBasic");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseC3(inner));
        } catch (err) {
            this.log.debug(`C3[${this.id}]: setBasic reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { HeatPumpControllerDevice, APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER };
