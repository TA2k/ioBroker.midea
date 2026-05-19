"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_REFRIGERATOR = 0xCA;

const TEMP_POS_LO = 1, TEMP_POS_HI = 29;
const TEMP_NEG_LO = 49, TEMP_NEG_HI = 54;

function decodeFlexTemp(v) {
    if (v >= TEMP_POS_LO && v <= TEMP_POS_HI) return v - 19;
    if (v >= TEMP_NEG_LO && v <= TEMP_NEG_HI) return 30 - v;
    return 0;
}

function parseCAGeneral(body) {
    const out = {};
    if (!body || body.length < 21) return out;
    out.codeMode = (body[1] & 0x01) > 0;
    out.freezingMode = (body[1] & 0x02) > 0;
    out.smartMode = (body[1] & 0x04) > 0;
    out.energySavingMode = (body[1] & 0x08) > 0;
    out.holidayMode = (body[1] & 0x10) > 0;
    out.moisturizeMode = (body[1] & 0x20) > 0;
    out.preservationMode = (body[1] & 0x40) > 0;
    out.acmeFreezingMode = (body[1] & 0x80) > 0;
    out.refrigeratorSettingTemp = body[2] & 0x0F;
    out.freezerSettingTemp = -12 - ((body[2] & 0xF0) >> 4);
    out.flexZoneSettingTemp = decodeFlexTemp(body[3]);
    out.rightFlexZoneSettingTemp = decodeFlexTemp(body[4]);
    out.variableMode = body[5];
    out.refrigerationPower = (body[6] & 0x01) === 0;
    out.lVariablePower = (body[6] & 0x04) === 0;
    out.rVariablePower = (body[6] & 0x08) === 0;
    out.freezingPower = (body[6] & 0x10) === 0;
    out.crossPeakElectricityEnter = (body[6] & 0x20) > 0;
    out.crossPeakElectricity = (body[6] & 0x40) > 0;
    out.allRefrigerationPower = (body[6] & 0x80) > 0;
    out.removeDew = (body[7] & 0x01) > 0;
    out.humidify = (body[7] & 0x02) > 0;
    out.unfreeze = (body[7] & 0x04) > 0;
    out.temperatureUnit = (body[7] & 0x08) ? "fahrenheit" : "celsius";
    out.floodLight = (body[7] & 0x10) > 0;
    out.functionSwitch = body[7] & 0xC0;
    out.radarMode = (body[8] & 0x01) > 0;
    out.milkMode = (body[8] & 0x02) > 0;
    out.icedMode = (body[8] & 0x04) > 0;
    out.plasmaAsepticMode = (body[8] & 0x08) > 0;
    out.acquireIceaMode = (body[8] & 0x10) > 0;
    out.brashIceaMode = (body[8] & 0x20) > 0;
    out.acquireWaterMode = (body[8] & 0x40) > 0;
    out.freezingIceMachinePower = (body[8] & 0x80) > 0;
    out.freezingFahrenheit = body[9];
    out.refrigerationFahrenheit = body[10] & 0xFC;
    out.leachExpireDay = body[11];
    out.energyConsumption = (body[13] << 8) + body[12];
    out.freezingMotorResetStatus = (body[14] & 0x01) > 0;
    out.freezingMotorDeicingStatus = (body[14] & 0x02) > 0;
    out.freezingIceMachineWaterStatus = (body[14] & 0x04) > 0;
    out.freezingAllIceStatus = (body[14] & 0x08) > 0;
    out.humanInduction = (body[14] & 0x10) > 0;
    out.refrigerationDoorPower = (body[15] & 0x01) > 0;
    out.freezingDoorPower = (body[15] & 0x02) > 0;
    out.barDoorPower = (body[15] & 0x04) > 0;
    out.iceMouthPower = (body[15] & 0x08) > 0;
    out.variableDoorPower = (body[15] & 0x10) > 0;
    out.storageIceHomeDoorState = (body[15] & 0x20) > 0;
    out.isError = (body[16] & 0x01) > 0;
    out.intervalRoomHumidityLevel = body[16] & 0xFE;
    out.refrigeratorActualTemp = (body[17] - 100) / 2;
    out.freezerActualTemp = (body[18] - 100) / 2;
    out.flexZoneActualTemp = (body[19] - 100) / 2;
    out.rightFlexZoneActualTemp = (body[20] - 100) / 2;
    if (body.length > 24) {
        out.fastColdMinute = (body[22] << 8) + body[21];
        out.fastFreezeMinute = (body[24] << 8) + body[23];
    }
    if (body.length > 25) {
        out.microcrystalFresh = (body[27] & 0x01) > 0;
        out.dryZone = (body[27] & 0x02) > 0;
        out.electronicSmell = (body[27] & 0x04) > 0;
        out.humidity = body[27] & 0x70;
        out.normalTemperatureLevel = body[28];
        out.functionZoneLevel = body[29];
    }
    if (body.length > 30) {
        out.humiditySetting = body[30] & 0x7F;
        out.smartHumidity = (body[30] & 0x80) > 0;
    }
    if (body.length > 31) {
        out.storageLeftDoorAuto = body[31] & 0x03;
        out.storageRightDoorAuto = body[31] & 0x0C;
        out.freezerDoorAuto = body[31] & 0x30;
        out.freezerDoorAutoControl = (body[31] & 0x40) > 0;
        out.storageDoorAutoControl = (body[31] & 0x80) > 0;
    }
    return out;
}

function parseCAException(body) {
    const out = {};
    if (!body || body.length < 4) return out;
    out.refrigeratorDoorOvertime = (body[1] & 0x01) > 0;
    out.freezerDoorOvertime = (body[1] & 0x02) > 0;
    out.barDoorOvertime = (body[1] & 0x04) > 0;
    out.flexZoneDoorOvertime = (body[1] & 0x08) > 0;
    out.iceMachineFull = (body[1] & 0x10) > 0;
    out.refrigerationSensorError = (body[2] & 0x01) > 0;
    out.refrigerationDefrostingSensorError = (body[2] & 0x02) > 0;
    out.ringTemperatureSensorError = (body[2] & 0x04) > 0;
    out.flexZoneSensorError = (body[2] & 0x08) > 0;
    out.rightFlexZoneSensorError = (body[2] & 0x10) > 0;
    out.freezingHighTemperature = (body[2] & 0x20) > 0;
    out.freezingSensorError = (body[2] & 0x40) > 0;
    out.freezingDefrostingSensorError = (body[2] & 0x80) > 0;
    out.iceElectricalMachineryError = (body[3] & 0x01) > 0;
    out.refrigerationDefrostingOvertime = (body[3] & 0x02) > 0;
    out.freezingDefrostingOvertime = (body[3] & 0x04) > 0;
    out.zeroCrossingCheckError = (body[3] & 0x08) > 0;
    return out;
}

function parseCANotify00(body) {
    const out = {};
    if (!body || body.length < 2) return out;
    out.refrigeratorDoor = (body[1] & 0x01) > 0;
    out.freezerDoor = (body[1] & 0x02) > 0;
    out.barDoor = (body[1] & 0x04) > 0;
    out.flexZoneDoor = (body[1] & 0x10) > 0;
    return out;
}

function parseCANotify01(body) {
    const out = {};
    if (!body || body.length < 41) return out;
    out.refrigeratorSettingTemp = body[37];
    out.freezerSettingTemp = -12 - body[38];
    out.flexZoneSettingTemp = decodeFlexTemp(body[39]);
    out.rightFlexZoneSettingTemp = decodeFlexTemp(body[40]);
    return out;
}

function parseCAReply(body, msgType) {
    if (!body || body.length === 0) return {};
    const bodyType = body[0];
    // notify1 (0x05) + 0x00 = door notify
    if (msgType === 0x05 && bodyType === 0x00) return parseCANotify00(body);
    // notify1 (0x05) + 0x02 = general body (CRUCIAL: not exception)
    if (msgType === 0x05 && bodyType === 0x02 && body.length > 20) return parseCAGeneral(body);
    // query/set + 0x00 = general body
    if ((msgType === 0x03 || msgType === 0x02) && bodyType === 0x00 && body.length > 20) return parseCAGeneral(body);
    // notify1/query + 0x01 = setpoint notify
    if ((msgType === 0x05 || msgType === 0x03) && bodyType === 0x01) return parseCANotify01(body);
    // query + 0x02 = exception
    if (msgType === 0x03 && bodyType === 0x02) return parseCAException(body);
    // fallback for older/uncertain msgType
    if (bodyType === 0x00 && body.length > 20) return parseCAGeneral(body);
    if (bodyType === 0x01) return parseCANotify01(body);
    if (bodyType === 0x02) return parseCAException(body);
    return {};
}

class RefrigeratorDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_REFRIGERATOR; }

    async refreshCapabilities() { return null; }
    async setStatus() { return this.status; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x00]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_REFRIGERATOR, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, ctx) {
        if (!frame || frame.length < 12) return undefined;
        const msgType = (ctx && ctx.msgType) != null ? ctx.msgType : frame[9];
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseCAReply(inner, msgType));
    }
}

module.exports = {
    RefrigeratorDevice,
    APPLIANCE_TYPE_REFRIGERATOR,
    parseCAGeneral,
    parseCAException,
    parseCANotify00,
    parseCANotify01,
};
