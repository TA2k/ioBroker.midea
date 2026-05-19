"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_LIGHT = 0x13;
const APPLIANCE_TYPE_BATHROOM_HEATER = 0x26;
const APPLIANCE_TYPE_DISHWASHER_X34 = 0x34;
const APPLIANCE_TYPE_BATHROOM_FAN = 0x40;

function parse13Body(body) {
    const out = {};
    if (!body || body.length < 9) return out;
    out.brightness = body[1];
    out.colorTemperature = body[2];
    out.effect = Math.min(5, Math.max(0, body[3] - 1));
    out.powerOn = body[8] > 0;
    return out;
}

function parse26Body(body) {
    const out = {};
    if (!body || body.length < 47) return out;
    out.mainLight = body[1] > 0;
    out.mainLightBrightness = body[2];
    out.nightLight = body[3] > 0;
    out.nightLightBrightness = body[4];
    if (body[31] !== 0xFF) out.currentHumidity = body[31];
    if (body[33] !== 0xFF) out.currentTemperature = body[33];
    const heatMode = body[9] > 0;
    const bathMode = body[13] > 0;
    const ventMode = body[18] > 0;
    const dryMode = body[21] > 0;
    const blowMode = body[26] > 0;
    let mode = 0, direction = 0xFD;
    if (heatMode) { mode = body[10] > 50 ? 1 : 2; direction = body[12]; }
    else if (bathMode) { mode = 3; direction = body[17]; }
    else if (blowMode) { mode = 4; direction = body[28]; }
    else if (ventMode) { mode = 5; direction = body[20]; }
    else if (dryMode) { mode = 6; direction = body[25]; }
    out.mode = mode;
    out.direction = direction;
    return out;
}

function parse34Body(body) {
    const out = {};
    if (!body || body.length < 17) return out;
    out.powerOn = body[1] > 0;
    out.statusCode = body[1];
    out.mode = body[2];
    out.doorOpen = (body[5] & 0x01) === 0;
    out.lackRinseAid = (body[5] & 0x02) > 0;
    out.lackSalt = (body[5] & 0x04) > 0;
    const startPause = (body[5] & 0x08) > 0;
    if (startPause) out.start = true;
    else if (body[1] === 2 || body[1] === 3) out.start = false;
    out.childLock = (body[5] & 0x10) > 0;
    out.uv = (body[4] & 0x02) > 0;
    out.dry = (body[4] & 0x10) > 0;
    out.timeRemaining = body[6];
    out.progress = body[9];
    out.temperature = body[11];
    if (body.length > 33) out.humidity = body[33];
    out.errorCode = body[10];
    return out;
}

function parse40Body(body) {
    const out = {};
    if (!body || body.length < 47) return out;
    out.light = body[1] > 0;
    out.mainLightBrightness = body[2];
    out.ventilation = body[18] > 0;
    out.currentTemperature = body[33];
    const blow = body[26] > 0;
    const blowSpeed = body[27];
    out.fanSpeed = blow ? (blowSpeed <= 30 ? 1 : 2) : 0;
    out.direction = body[28];
    out.smellySensor = body[45] > 0;
    return out;
}

class LightDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_LIGHT; }
    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x24, 0x00, 0x00, 0x00, 0x00]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_LIGHT, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        if (inner[0] === 0xA4) this._mergeStatus(parse13Body(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        let bodyType, val;
        if (updates.powerOn !== undefined) { bodyType = 0x01; val = updates.powerOn ? 0x01 : 0x00; }
        else if (updates.effect !== undefined && updates.effect >= 1 && updates.effect <= 5) { bodyType = 0x01; val = Number(updates.effect) + 1; }
        else if (updates.colorTemperature !== undefined) { bodyType = 0x03; val = Number(updates.colorTemperature) & 0xFF; }
        else if (updates.brightness !== undefined) { bodyType = 0x04; val = Number(updates.brightness) & 0xFF; }
        else return this.status;
        const cmd = createCommand(Buffer.from([bodyType, val, 0x00, 0x00, 0x00]), {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_LIGHT, addCrc: false,
        });
        await this._request(cmd, "setStatus");
        return this.status;
    }
}

class BathroomHeaterDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_BATHROOM_HEATER; }
    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_BATHROOM_HEATER, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        if (inner[0] === 0x01) this._mergeStatus(parse26Body(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.mainLight === undefined && updates.nightLight === undefined && updates.mode === undefined) {
            return this.status;
        }
        const mainLight = updates.mainLight !== undefined ? !!updates.mainLight : !!this.status.mainLight;
        const nightLight = updates.nightLight !== undefined ? !!updates.nightLight : !!this.status.nightLight;
        const mode = updates.mode !== undefined ? Number(updates.mode) : (this.status.mode || 0);
        const direction = updates.direction !== undefined ? Number(updates.direction) : 0xFD;
        const heatTemp = mode === 1 ? 55 : (mode === 2 ? 30 : 0);
        const body = Buffer.alloc(40, 0x00);
        body[0] = 0x01;
        body[1] = mainLight ? 1 : 0;
        body[3] = nightLight ? 1 : 0;
        body[9] = (mode === 1 || mode === 2) ? 1 : 0;
        body[10] = heatTemp;
        body[12] = direction;
        body[13] = mode === 3 ? 1 : 0;
        body[17] = direction;
        body[18] = mode === 5 ? 1 : 0;
        body[20] = direction;
        body[21] = mode === 6 ? 1 : 0;
        body[25] = direction;
        body[26] = mode === 4 ? 1 : 0;
        body[28] = direction;
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_BATHROOM_HEATER, addCrc: false,
        });
        await this._request(cmd, "setStatus");
        return this.status;
    }
}

class DishwasherX34Device extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_DISHWASHER_X34; }
    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x00]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DISHWASHER_X34, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parse34Body(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const body = Buffer.from([0x08, updates.powerOn ? 0x01 : 0x00, 0x00, 0x00, 0x00]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_DISHWASHER_X34, addCrc: false,
            });
            await this._request(cmd, "setPower");
            return this.status;
        }
        if (updates.childLock !== undefined) {
            const body = Buffer.concat([Buffer.from([0x83, updates.childLock ? 0x03 : 0x04]), Buffer.alloc(36, 0x00)]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_DISHWASHER_X34, addCrc: false,
            });
            await this._request(cmd, "setLock");
            return this.status;
        }
        return this.status;
    }
}

class BathroomFanDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_BATHROOM_FAN; }
    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const cmd = createCommand(Buffer.from([0x01]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_BATHROOM_FAN, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        if (inner[0] === 0x01) this._mergeStatus(parse40Body(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        if (updates.light === undefined && updates.fanSpeed === undefined &&
            updates.ventilation === undefined && updates.smellySensor === undefined) {
            return this.status;
        }
        const light = updates.light !== undefined ? !!updates.light : !!this.status.light;
        const fanSpeed = updates.fanSpeed !== undefined ? Number(updates.fanSpeed) : (this.status.fanSpeed || 0);
        const ventilation = updates.ventilation !== undefined ? !!updates.ventilation : !!this.status.ventilation;
        const smelly = updates.smellySensor !== undefined ? !!updates.smellySensor : !!this.status.smellySensor;
        const direction = updates.direction !== undefined ? Number(updates.direction) : 0xFD;
        const blow = fanSpeed > 0 ? 1 : 0;
        const blowSpeed = fanSpeed === 0 ? 0xFF : (fanSpeed === 1 ? 30 : 100);
        const body = Buffer.alloc(40, 0x00);
        body[0] = 0x01;
        body[1] = light ? 1 : 0;
        body[18] = ventilation ? 1 : 0;
        body[26] = blow;
        body[27] = blowSpeed;
        body[28] = direction;
        body[38] = smelly ? 1 : 0;
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_BATHROOM_FAN, addCrc: false,
        });
        await this._request(cmd, "setStatus");
        return this.status;
    }
}

module.exports = {
    LightDevice, APPLIANCE_TYPE_LIGHT,
    BathroomHeaterDevice, APPLIANCE_TYPE_BATHROOM_HEATER,
    DishwasherX34Device, APPLIANCE_TYPE_DISHWASHER_X34,
    BathroomFanDevice, APPLIANCE_TYPE_BATHROOM_FAN,
};
