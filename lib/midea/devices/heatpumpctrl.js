"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER = 0xC3;

const SILENT_LEVELS = { off: 0x00, super_silent: 0x01, silent: 0x09 };

function parseC3Basic(body, off) {
    const out = {};
    if (!body || body.length < off + 22) return out;
    // Byte 1: zone power flags
    out.zone1Power = (body[off] & 0x01) > 0;
    out.zone2Power = (body[off] & 0x02) > 0;
    out.dhwPower = (body[off] & 0x04) > 0;
    out.zone1Curve = (body[off] & 0x08) > 0;
    out.zone2Curve = (body[off] & 0x10) > 0;
    out.tbh = (body[off] & 0x20) > 0;
    out.fastDhw = (body[off] & 0x40) > 0;
    out.remoteOnoff = (body[off] & 0x80) > 0;
    // Byte 2: capability flags
    out.heat = (body[off + 1] & 0x01) > 0;
    out.cool = (body[off + 1] & 0x02) > 0;
    out.dhw = (body[off + 1] & 0x04) > 0;
    out.doubleZone = (body[off + 1] & 0x08) > 0;
    out.zone1TempType = (body[off + 1] & 0x10) > 0;
    out.zone2TempType = (body[off + 1] & 0x20) > 0;
    out.roomThermalSupport = (body[off + 1] & 0x40) > 0;
    out.roomThermalState = (body[off + 1] & 0x80) > 0;
    // Byte 3: misc flags + zone terminal type
    out.timeSet = (body[off + 2] & 0x01) > 0;
    out.silentMode = (body[off + 2] & 0x02) > 0;
    out.holidayOn = (body[off + 2] & 0x04) > 0;
    out.ecoMode = (body[off + 2] & 0x08) > 0;
    out.zoneTerminalType = body[off + 2];
    out.mode = body[off + 3];
    out.modeAuto = body[off + 4];
    out.zone1TargetTemp = body[off + 5];
    out.zone2TargetTemp = body[off + 6];
    out.dhwTargetTemp = body[off + 7];
    out.roomTargetTemp = body[off + 8] / 2;
    if (body.length >= off + 21) {
        out.zone1HeatingTempMax = body[off + 9];
        out.zone1HeatingTempMin = body[off + 10];
        out.zone1CoolingTempMax = body[off + 11];
        out.zone1CoolingTempMin = body[off + 12];
        out.zone2HeatingTempMax = body[off + 13];
        out.zone2HeatingTempMin = body[off + 14];
        out.zone2CoolingTempMax = body[off + 15];
        out.zone2CoolingTempMin = body[off + 16];
        out.roomTempMax = body[off + 17] / 2;
        out.roomTempMin = body[off + 18] / 2;
        out.dhwTempMax = body[off + 19];
        out.dhwTempMin = body[off + 20];
    }
    out.tankActualTemperature = body[off + 21];
    out.errorCode = body[off + 22];
    if (body.length > off + 23) {
        out.tbhControl = (body[off + 23] & 0x80) > 0;
        out.sysEnergyAnaEN = (body[off + 23] & 0x20) > 0;
        out.hmiEnergyAnaSetEN = (body[off + 23] & 0x40) > 0;
    }
    return out;
}

function parseC3Energy(body, off) {
    const out = {};
    if (!body || body.length < off + 14) return out;
    const sb = body[off];
    out.statusHeating = (sb & 0x01) > 0;
    out.statusCool = (sb & 0x02) > 0;
    out.statusDhw = (sb & 0x04) > 0;
    out.statusTbh = (sb & 0x08) > 0;
    out.statusIbh = (sb & 0x10) > 0;
    out.totalEnergyConsumption = (body[off + 1] * 0x1000000)
        + (body[off + 2] << 16) + (body[off + 3] << 8) + body[off + 4];
    out.totalProducedEnergy = (body[off + 5] * 0x1000000)
        + (body[off + 6] << 16) + (body[off + 7] << 8) + body[off + 8];
    const t4 = body[off + 9];
    out.outdoorTemperature = t4 > 127 ? t4 - 256 : t4;
    out.zone1TempSet = body[off + 10];
    out.zone2TempSet = body[off + 11];
    out.t5s = body[off + 12];
    out.tas = body[off + 13];
    return out;
}

function parseC3UnitPara(body, off) {
    const out = {};
    if (!body || body.length < off + 14) return out;
    out.compRunFreq = body[off];
    out.unitModeRun = body[off + 1];
    out.fanSpeedRpm = body[off + 3] * 10;
    out.capacityNeed = body[off + 5];
    out.tempT3 = body[off + 6];
    out.tempT4 = body[off + 7];
    out.tempTp = body[off + 8];
    out.tempTwIn = body[off + 9];
    out.tempTwOut = body[off + 10];
    out.tempTsolar = body[off + 11];
    out.hydboxSubtype = body[off + 12];
    out.usbInfoConnect = body[off + 13];
    if (body.length >= off + 22) {
        out.oduVoltage = (body[off + 17] << 8) | body[off + 18];
        out.exvCurrent = (body[off + 19] << 8) | body[off + 20];
        out.oduModel = body[off + 21];
    }
    if (body.length >= off + 41) {
        out.tempT1 = body[off + 33];
        out.tempTw2 = body[off + 34];
        out.tempT2 = body[off + 35];
        out.tempT2b = body[off + 36];
        out.tempT5 = body[off + 37];
        out.tempTa = body[off + 38];
        out.tempTbT1 = body[off + 39];
        out.tempTbT2 = body[off + 40];
    }
    if (body.length >= off + 47) {
        out.hydroboxCapacity = body[off + 41];
        out.pressureHigh = (body[off + 42] << 8) | body[off + 43];
        out.pressureLow = (body[off + 44] << 8) | body[off + 45];
        out.tempTh = body[off + 46];
    }
    if (body.length >= off + 50) {
        out.machineType = body[off + 47];
        out.oduTargetFre = body[off + 48];
        out.dcCurrent = body[off + 49];
    }
    if (body.length >= off + 54) {
        out.tempTf = body[off + 51];
        out.iduT1s1 = body[off + 52];
        out.iduT1s2 = body[off + 53];
    }
    if (body.length >= off + 56) {
        out.waterFlow = (body[off + 54] << 8) | body[off + 55];
    }
    if (body.length >= off + 64) {
        out.oduPlanVolLmt = body[off + 56];
        out.currentUnitCapacity = body[off + 57];
        out.sphereAhsVoltage = body[off + 59];
        out.tempT4aVer = body[off + 60];
        out.waterPressure = (body[off + 61] << 8) | body[off + 62];
        out.roomRelHum = body[off + 63];
    }
    return out;
}

function parseC3Silence(body, off) {
    const out = {};
    if (!body || body.length < off + 1) return out;
    const b = body[off];
    out.silentMode = (b & 0x01) > 0;
    // C3SilentLevel encoding: bit0 + (bit3 >> 2) -> {0:OFF, 1:SILENT, 3:SUPER_SILENT}
    out.silentLevel = out.silentMode ? ((b & 0x01) + ((b & 0x08) >> 2)) : 0;
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
    if (bt === 0x04) return parseC3Energy(body, 1);
    if (bt === 0x05) return parseC3Silence(body, 1);
    if (bt === 0x07) return parseC3Eco(body, 1);
    if (bt === 0x09) return parseC3Disinfect(body, 1);
    if (bt === 0x10) return parseC3UnitPara(body, 1);
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
        return this._processFrame(reply, { source: "query", msgType: reply[9] });
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseC3(inner));
    }

    async refreshStatus() {
        for (const bt of [0x01, 0x05, 0x07, 0x09, 0x10]) {
            try { await this._query(bt); }
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
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { HeatPumpControllerDevice, APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER };
