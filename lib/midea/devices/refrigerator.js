"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_REFRIGERATOR = 0xCA;

function parseCABody(body) {
    const out = {};
    if (!body || body.length < 21) return out;
    out.codeMode = (body[1] & 0x01) > 0;
    out.freezingMode = (body[1] & 0x02) > 0;
    out.smartMode = (body[1] & 0x04) > 0;
    out.energySavingMode = (body[1] & 0x08) > 0;
    out.holidayMode = (body[1] & 0x10) > 0;
    out.moisturizeMode = (body[1] & 0x20) > 0;
    out.preservationMode = (body[1] & 0x40) > 0;
    out.refrigeratorSettingTemp = body[2] & 0x0F;
    out.freezerSettingTemp = -12 - ((body[2] & 0xF0) >> 4);
    const flexSet = body[3];
    if (flexSet >= 1 && flexSet <= 29) out.flexZoneSettingTemp = flexSet - 19;
    else if (flexSet >= 49 && flexSet <= 54) out.flexZoneSettingTemp = 30 - flexSet;
    else out.flexZoneSettingTemp = 0;
    out.variableMode = body[5];
    out.refrigerationPower = (body[6] & 0x01) === 0;
    out.freezingPower = (body[6] & 0x10) === 0;
    out.refrigeratorActualTemp = (body[17] - 100) / 2;
    out.freezerActualTemp = (body[18] - 100) / 2;
    out.flexZoneActualTemp = (body[19] - 100) / 2;
    out.energyConsumption = (body[13] << 8) + body[12];
    if (body.length > 27) {
        out.microcrystalFresh = (body[27] & 0x01) > 0;
        out.dryZone = (body[27] & 0x02) > 0;
        out.electronicSmell = (body[27] & 0x04) > 0;
        out.humidity = body[27] & 0x70;
    }
    if (body.length > 30) out.humiditySetting = body[30] & 0x7F;
    return out;
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
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseCABody(inner));
        return this.status;
    }
}

module.exports = { RefrigeratorDevice, APPLIANCE_TYPE_REFRIGERATOR };
