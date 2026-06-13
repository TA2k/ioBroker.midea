"use strict";

const { BaseDevice } = require("./base");
const { createCommand, calculateCrc } = require("../packet");

const APPLIANCE_TYPE_COMMERCIAL_AC = 0xCC;

const MODES_BY_INDEX = { 0: "off", 1: "auto", 2: "cool", 3: "dry", 4: "heat", 5: "fan" };
const MODES_BY_NAME = { off: 0, auto: 1, cool: 2, dry: 3, heat: 4, fan: 5 };

// 0xFE format byte at body[1] flags the newer VRF panel layout
// (171PNL01 / 171PANEL). Decoded with the legacy table the indoor sensor
// drifts to -20°C and mode is stuck on auto. midea-local commit c77aeef.
const FE_FORMAT_BYTE = 0xFE;
const MAX_VALID_INDOOR_TEMP = 60;
const FE_SWING_AUTO = 0x06;

// 0xFE-format operational_mode (body[31]) -> internal mode index used here
// (1=auto, 2=cool, 3=dry, 4=heat, 5=fan). Mapping copied from
// midea-local FE_MODE_TO_INDEX (with our mode-index numbering).
const FE_MODE_TO_INDEX = { 0x05: 1, 0x02: 2, 0x06: 3, 0x03: 4, 0x01: 5 };
const INDEX_TO_FE_MODE = { 1: 0x05, 2: 0x02, 3: 0x06, 4: 0x03, 5: 0x01 };

// 0xFE control-frame TLV ids (key-value control protocol).
const FE_CONTROL_ID = {
    POWER: 0x0000,
    TARGET_TEMPERATURE: 0x0003,
    MODE: 0x0012,
    FAN_SPEED: 0x0015,
    SWING: 0x001C,
    ECO: 0x0028,
    SLEEP: 0x002C,
};

let _feMessageId = 0;
function _nextFeMessageId() {
    _feMessageId = (_feMessageId + 1) & 0xFF;
    return _feMessageId;
}

/**
 * 0xCC commercial AC. Layout taken from midea-local devices/cc/message.py.
 * Query: body_type=0x01, msg_type=0x03; Set: body_type=0xC3, msg_type=0x02.
 * Response body_type 0x01 (query/notify) or 0xC3 (set ack) -> CCGeneralMessageBody.
 */
function parseCCBody(body) {
    const out = {};
    if (!body || body.length < 2) return out;
    if (body[1] === FE_FORMAT_BYTE) {
        // 0xFE VRF panel layout (171PNL01 / 171PANEL). midea-local
        // commit c77aeef, originally reverse-engineered by msmart-ng.
        if (body.length < 35) return out;
        out.feFormat = true;
        out.powerOn = !!body[8];
        out.targetTemperature = (body[11] / 2) - 40;
        const indoor = ((body[12] << 8) | body[13]) / 10;
        out.indoorTemperature = indoor > 0 && indoor < MAX_VALID_INDOOR_TEMP ? indoor : null;
        out.modeIndex = FE_MODE_TO_INDEX[body[31]] || 1;
        out.mode = MODES_BY_INDEX[out.modeIndex] || "unknown";
        if (body.length > 34) out.fanSpeed = body[34];
        if (body.length > 56) out.ecoMode = !!body[56];
        if (body.length > 60) out.sleepMode = !!body[60];
        if (body.length > 41) out.swing = body[41] === FE_SWING_AUTO;
        if (body.length > 21) out.tempFahrenheit = !!body[21];
        out.nightLight = false;
        out.ventilation = false;
        out.auxHeatStatus = 0;
        out.autoAuxHeatRunning = false;
        out.fanSpeedLevel = false;
        out.temperaturePrecision = 0.5;
        return out;
    }
    if (body.length < 21) return out;
    out.powerOn = (body[1] & 0x80) > 0;
    let modeRaw = body[1] & 0x1F;
    let modeIdx = 0;
    while (modeRaw >= 1) { modeRaw = modeRaw / 2; modeIdx++; }
    out.modeIndex = modeIdx;
    out.mode = MODES_BY_INDEX[modeIdx] || "unknown";
    out.fanSpeed = body[2];
    out.targetTemperature = body[3] + body[19] / 10;
    out.indoorTemperature = (body[4] - 40) / 2;
    out.ecoMode = (body[13] & 0x01) > 0;
    out.autoAuxHeatRunning = (body[13] & 0x02) > 0;
    out.swing = (body[13] & 0x04) > 0;
    out.ventilation = (body[13] & 0x08) > 0;
    out.fanSpeedLevel = (body[13] & 0x40) > 0;
    out.nightLight = (body[14] & 0x08) > 0;
    out.sleepMode = (body[14] & 0x10) > 0;
    out.auxHeatStatus = (body[14] & 0x60) >> 5;
    out.temperaturePrecision = (body[14] & 0x80) > 0 ? 1 : 0.5;
    out.tempFahrenheit = (body[20] & 0x80) > 0;
    return out;
}

class CommercialACDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_COMMERCIAL_AC; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(23, 0x00)]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_COMMERCIAL_AC,
        });
        this.log.debug(`CC[${this.id}]: refreshStatus() -> sending 0x01 query`);
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseCCBody(inner));
    }

    async setStatus(updates = {}) {
        const cur = this.status || {};
        // 0xFE VRF panels (171PNL01 / 171PANEL) ignore the legacy 0xC3 set
        // frame and require a TLV control frame instead. midea-local
        // commit c77aeef. Pick the right path off the parsed status.
        if (cur.feFormat) {
            return this._setStatusFE(updates);
        }
        const fld = (k, def) => updates[k] !== undefined ? updates[k] : (cur[k] !== undefined ? cur[k] : def);
        const power = updates.powerOn !== undefined ? !!updates.powerOn : !!cur.powerOn;
        let modeIdx = cur.modeIndex !== undefined ? cur.modeIndex : 4;
        if (updates.mode !== undefined) {
            modeIdx = typeof updates.mode === "string" ? MODES_BY_NAME[updates.mode] : Number(updates.mode);
            if (modeIdx === undefined || modeIdx < 1 || modeIdx > 5) {
                throw new Error(`CC[${this.id}]: invalid mode '${updates.mode}'`);
            }
        }
        if (modeIdx < 1) modeIdx = 4;
        const fanSpeed = Number(fld("fanSpeed", 0x80)) & 0xFF;
        const target = Number(fld("targetTemperature", 26));
        const tInt = Math.floor(target) & 0xFF;
        const tDot = Math.round((target - tInt) * 10) & 0xFF;
        const eco = !!fld("ecoMode", false);
        const ventilation = !!fld("ventilation", false);
        const swing = !!fld("swing", false);
        const sleep = !!fld("sleepMode", false);
        const nightLight = !!fld("nightLight", false);
        const auxHeat = Number(fld("auxHeatStatus", 0)) & 0xFF;
        let auxByte = 0;
        if (auxHeat === 1) auxByte = 0x10;
        else if (auxHeat === 2) auxByte = 0x20;
        const setBody = Buffer.concat([Buffer.from([0xC3]), Buffer.from([
            (power ? 0x80 : 0x00) | (1 << (modeIdx - 1)),
            fanSpeed,
            tInt,
            0x00, 0x00,
            (eco ? 0x01 : 0) | (ventilation ? 0x08 : 0) | (swing ? 0x04 : 0) | auxByte,
            0xFF,
            (sleep ? 0x10 : 0) | (nightLight ? 0x08 : 0),
            0x00, 0x00,
            tDot,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ])]);
        const cmd = createCommand(setBody, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_COMMERCIAL_AC,
        });
        this.log.debug(`CC[${this.id}]: setStatus(${JSON.stringify(updates)}) -> sending 0xC3 frame`);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    /**
     * 0xFE VRF panel control: instead of one big set frame, the appliance
     * accepts a list of TLV (id, length, value, 0xFF) tuples followed by an
     * incrementing message id and CRC8. midea-local MessageFEControl,
     * commit c77aeef. We send a TLV pack only for fields the caller
     * actually changed — empty packs are rejected by the firmware.
     *
     * @param {object} updates
     */
    async _setStatusFE(updates) {
        const cur = this.status || {};
        const tlvs = [];
        if (updates.powerOn !== undefined) {
            tlvs.push([FE_CONTROL_ID.POWER, updates.powerOn ? 1 : 0]);
        }
        if (updates.targetTemperature !== undefined) {
            const t = Math.round((Number(updates.targetTemperature) + 40) * 2) & 0xFF;
            tlvs.push([FE_CONTROL_ID.TARGET_TEMPERATURE, t]);
        }
        if (updates.mode !== undefined) {
            const idx = typeof updates.mode === "string" ? MODES_BY_NAME[updates.mode] : Number(updates.mode);
            if (!INDEX_TO_FE_MODE[idx]) throw new Error(`CC[${this.id}]: invalid FE mode '${updates.mode}'`);
            tlvs.push([FE_CONTROL_ID.MODE, INDEX_TO_FE_MODE[idx]]);
        }
        if (updates.fanSpeed !== undefined) {
            tlvs.push([FE_CONTROL_ID.FAN_SPEED, Number(updates.fanSpeed) & 0xFF]);
        }
        if (updates.swing !== undefined) {
            tlvs.push([FE_CONTROL_ID.SWING, updates.swing ? FE_SWING_AUTO : 0x00]);
        }
        if (updates.ecoMode !== undefined) {
            tlvs.push([FE_CONTROL_ID.ECO, updates.ecoMode ? 1 : 0]);
        }
        if (updates.sleepMode !== undefined) {
            tlvs.push([FE_CONTROL_ID.SLEEP, updates.sleepMode ? 1 : 0]);
        }
        if (!tlvs.length) return cur;

        const parts = [];
        for (const [id, value] of tlvs) {
            // 2-byte big-endian id, 1-byte length=1, 1-byte value, 0xFF
            // separator, exactly as midea-local MessageFEControl.body.
            parts.push(Buffer.from([(id >> 8) & 0xFF, id & 0xFF, 0x01, value & 0xFF, 0xFF]));
        }
        parts.push(Buffer.from([_nextFeMessageId()]));
        const payload = Buffer.concat(parts);
        const crc = calculateCrc(payload);
        const setBody = Buffer.concat([payload, Buffer.from([crc])]);
        // The TLV body already carries its own message-id+crc; pass
        // addCrc=false so packet.createCommand doesn't append a second CRC.
        const cmd = createCommand(setBody, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_COMMERCIAL_AC,
            addCrc: false,
        });
        this.log.debug(`CC[${this.id}]: setStatusFE(${JSON.stringify(updates)}) -> ${tlvs.length} TLV controls`);
        const reply = await this._request(cmd, "setStatusFE");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }
}

module.exports = { CommercialACDevice, APPLIANCE_TYPE_COMMERCIAL_AC };
