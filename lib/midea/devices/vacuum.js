"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_VACUUM = 0xB8;

const WORK_STATUS = {
    0x00: "none", 0x01: "charge", 0x02: "work", 0x03: "stop",
    0x04: "charging_on_dock", 0x05: "reserve_task_finished", 0x06: "charge_finish",
    0x07: "charging_with_wire", 0x08: "pause", 0x09: "updating", 0x0A: "saving_map",
    0x0B: "error", 0x0C: "sleep", 0x0D: "charge_pause", 0x0E: "relocate",
    0x0F: "electrolysed_water_making", 0x10: "dust_collecting",
    0x11: "back_dust_collecting", 0x12: "sleep_in_station",
};

const WORK_MODE_VALUES = { charge: 0x01, work: 0x02, stop: 0x03, pause: 0x1B };

function parseB8Body(body, offset) {
    const out = {};
    if (!body || body.length < 20 + offset) return out;
    out.workStatus = WORK_STATUS[body[1 + offset]] || `0x${body[1 + offset].toString(16)}`;
    out.functionType = body[2 + offset];
    out.controlType = body[3 + offset];
    out.moveDirection = body[4 + offset];
    out.cleanMode = body[5 + offset];
    out.fanLevel = body[6 + offset];
    out.area = body[7 + offset];
    out.waterLevel = body[8 + offset];
    out.voiceVolume = Math.min(100, body[9 + offset]);
    out.haveReserveTask = body[10 + offset] > 0;
    out.batteryPercent = Math.min(100, body[11 + offset]);
    out.workTime = body[12 + offset];
    out.uvSwitch = (body[13 + offset] & 0x01) > 0;
    out.wifiSwitch = (body[13 + offset] & 0x02) > 0;
    out.voiceSwitch = (body[13 + offset] & 0x04) > 0;
    out.commandSource = (body[13 + offset] & 0x40) > 0;
    out.deviceError = (body[13 + offset] & 0x80) > 0;
    out.errorType = body[14 + offset];
    out.errorCode = body[15 + offset];
    out.mop = body[16 + offset];
    out.carpetSwitch = body[17 + offset] > 0;
    out.laserSensorError = (body[18 + offset] & 0x01) > 0;
    out.laserSensorShelter = (body[18 + offset] & 0x02) > 0;
    out.boardCommunicationError = (body[18 + offset] & 0x04) > 0;
    out.speed = body[19 + offset];
    return out;
}

class VacuumDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_VACUUM; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x32, 0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_VACUUM, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        if (inner[0] === 0x32 && inner[1] === 0x01) this._mergeStatus(parseB8Body(inner, 1));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.workMode !== undefined) {
            // 0x01=charge, 0x02=work, 0x03=stop, 0x1B=pause
            let wm;
            if (typeof updates.workMode === "string") {
                wm = WORK_MODE_VALUES[updates.workMode];
                if (wm === undefined) throw new Error(`B8[${this.id}]: invalid workMode '${updates.workMode}'`);
            } else {
                wm = Number(updates.workMode) & 0xFF;
            }
            const body = Buffer.from([0x22, wm, 0x00, 0x00]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_VACUUM, addCrc: false,
            });
            await this._request(cmd, "setWorkMode");
            return this.status;
        }
        if (updates.cleanMode !== undefined || updates.fanLevel !== undefined ||
            updates.waterLevel !== undefined || updates.voiceVolume !== undefined) {
            const cleanMode = updates.cleanMode !== undefined ? Number(updates.cleanMode) : 0x02;
            const fanLevel = updates.fanLevel !== undefined ? Number(updates.fanLevel) : 0x02;
            const waterLevel = updates.waterLevel !== undefined ? Number(updates.waterLevel) : 0x01;
            const voiceVolume = updates.voiceVolume !== undefined ? Number(updates.voiceVolume) : 0;
            const zoneId = updates.zoneId !== undefined ? Number(updates.zoneId) : 0;
            const body = Buffer.concat([
                Buffer.from([0x22, 0x02, 0x02, cleanMode, fanLevel, waterLevel, voiceVolume, zoneId]),
                Buffer.alloc(7, 0x00),
            ]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_VACUUM, addCrc: false,
            });
            await this._request(cmd, "setStatus");
            return this.status;
        }
        return this.status;
    }
}

module.exports = { VacuumDevice, APPLIANCE_TYPE_VACUUM };
