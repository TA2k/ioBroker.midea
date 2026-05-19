"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFrame, parseA1Response } = require("../parsers");

const APPLIANCE_TYPE_DEHUMIDIFIER = 0xA1;

const MODE_BY_NAME = { setpoint: 1, continuous: 2, smart: 3, dryer: 4 };
const MODE_BY_INDEX = { 1: "setpoint", 2: "continuous", 3: "smart", 4: "dryer" };
const FAN_BY_NAME = { silent: 40, low: 60, medium: 70, high: 80, auto: 102 };
const FAN_NAME_BY_VALUE = { 40: "silent", 60: "low", 70: "medium", 80: "high", 102: "auto" };

function clampNumber(v, min, max) {
    if (typeof v !== "number" || Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
}

/**
 * 0xA1 dehumidifier. Command/response layout taken from
 * midea-beautiful-air (DehumidifierStatusCommand / DehumidifierSetCommand /
 * DehumidifierResponse). Response decoding mirrors the Python class
 * one-to-one so we get the same field surface.
 */
class DehumidifierDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this._setMessageId = 1;
    }

    get applianceType() { return APPLIANCE_TYPE_DEHUMIDIFIER; }

    async refreshCapabilities() {
        const cmd = createCommand(Buffer.from([0xB5, 0x01, 0x00]), {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DEHUMIDIFIER,
        });
        this.log.debug(`DH[${this.id}]: refreshCapabilities() -> sending B5 query`);
        const reply = await this._request(cmd, "getCapabilities");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`DH[${this.id}]: refreshCapabilities() <- type=0x${(parsed.type || 0).toString(16)} more=${parsed.more}`);
        if (parsed.type !== 0xB5) throw new Error(`DH[${this.id}]: unexpected capability response 0x${(parsed.type || 0).toString(16)}`);

        let caps = parsed.capabilities;
        let more = parsed.more;
        let safety = 4;
        while (more && safety-- > 0) {
            const moreCmd = createCommand(Buffer.from([0xB5, 0x01, 0x01, more & 0xff]), {
                msgType: 0x03,
                protocol: 0x03,
                applianceType: APPLIANCE_TYPE_DEHUMIDIFIER,
            });
            const moreReply = await this._request(moreCmd, "getMoreCapabilities");
            /** @type {any} */
            const moreParsed = parseFrame(moreReply);
            if (moreParsed.type !== 0xB5) break;
            caps = { ...caps, ...moreParsed.capabilities };
            more = moreParsed.more;
        }

        this.capabilities = caps;
        this.log.debug(`DH[${this.id}]: capabilities resolved -> ${Object.keys(caps).filter((k) => caps[k] === true).join(", ")}`);
        this.emit("capabilities", caps);
        return caps;
    }

    async refreshStatus() {
        const body = Buffer.from([
            0x41, 0x81, 0x00, 0xFF, 0x03, 0xFF, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DEHUMIDIFIER,
        });
        this.log.debug(`DH[${this.id}]: refreshStatus() -> sending 0x41 query`);
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        const status = parseA1Response(inner);
        this.log.debug(`DH[${this.id}]: refreshStatus() <- bytes=${reply.length} keys=${Object.keys(status).length}`);

        const normalized = this._normalizeStatus(status);
        const merged = this._mergeStatus(normalized);
        if (Object.keys(merged).length) {
            this.log.debug(`DH[${this.id}]: status changed -> ${JSON.stringify(merged)}`);
        }
        return this.status;
    }

    /**
     * Apply changes. Properties not present in `updates` keep the current
     * known value (read from this.status), so callers should refreshStatus()
     * before issuing setStatus().
     */
    async setStatus(updates = {}) {
        /** @type {any} */
        const status = { ...this.status };

        if (updates.mode !== undefined) {
            const m = typeof updates.mode === "string" ? MODE_BY_NAME[updates.mode] : Number(updates.mode);
            if (!m) throw new Error(`DH[${this.id}]: invalid mode '${updates.mode}'`);
            status._modeIndex = m;
        } else if (status.mode) {
            status._modeIndex = MODE_BY_NAME[status.mode] || 1;
        } else {
            status._modeIndex = 1;
        }

        if (updates.fanSpeed !== undefined) {
            if (typeof updates.fanSpeed === "string") {
                if (FAN_BY_NAME[updates.fanSpeed] === undefined) {
                    throw new Error(`DH[${this.id}]: invalid fanSpeed '${updates.fanSpeed}'`);
                }
                status.fanSpeed = FAN_BY_NAME[updates.fanSpeed];
            } else {
                status.fanSpeed = clampNumber(Number(updates.fanSpeed), 0, 127);
            }
        }
        if (status.fanSpeed === undefined) status.fanSpeed = 40;

        if (updates.powerOn !== undefined) status.powerOn = !!updates.powerOn;

        if (updates.targetHumidity !== undefined) {
            const v = clampNumber(Number(updates.targetHumidity), 0, 100);
            status.targetHumidity = v;
        }
        if (status.targetHumidity === undefined) status.targetHumidity = 50;

        if (updates.ionMode !== undefined) status.ionMode = !!updates.ionMode;
        if (updates.sleepMode !== undefined) status.sleepMode = !!updates.sleepMode;
        if (updates.pumpSwitch !== undefined) status.pumpSwitch = !!updates.pumpSwitch;
        if (updates.pumpSwitchFlag !== undefined) status.pumpSwitchFlag = !!updates.pumpSwitchFlag;
        if (updates.verticalSwing !== undefined) status.verticalSwing = !!updates.verticalSwing;
        if (updates.beep !== undefined) status._beep = !!updates.beep; else status._beep = true;
        if (updates.tankWarningLevel !== undefined) {
            status.tankWarningLevel = clampNumber(Number(updates.tankWarningLevel), 0, 100);
        }

        const cmd = createCommand(this._buildSetBody(status), {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_DEHUMIDIFIER,
        });
        this.log.debug(`DH[${this.id}]: setStatus(${JSON.stringify(updates)}) -> sending 0x48 frame`);
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            const parsed = parseA1Response(inner);
            this._mergeStatus(this._normalizeStatus(parsed));
        } catch (err) {
            this.log.debug(`DH[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }

    _normalizeStatus(raw) {
        const out = { ...raw };
        out.modeIndex = raw.mode;
        out.mode = MODE_BY_INDEX[raw.mode] || "off";
        if (raw.fanSpeed !== undefined) {
            out.fanSpeed = raw.fanSpeed;
            out.fanSpeedName = FAN_NAME_BY_VALUE[raw.fanSpeed] || "custom";
        }
        return out;
    }

    /**
     * @param {any} s
     * @returns {Buffer}
     */
    _buildSetBody(s) {
        const cmd = Buffer.alloc(20);
        cmd[0] = 0x48;
        cmd[1] = (s._beep ? 0x40 : 0x00) | (s.powerOn ? 0x01 : 0x00);
        cmd[2] = s._modeIndex & 0x0F;
        cmd[3] = s.fanSpeed & 0x7F;
        cmd[7] = s.targetHumidity & 0x7F;
        cmd[9] =
            (s.ionMode ? 0x40 : 0x00) |
            (s.sleepMode ? 0x20 : 0x00) |
            (s.pumpSwitchFlag ? 0x10 : 0x00) |
            (s.pumpSwitch ? 0x08 : 0x00);
        cmd[10] = s.verticalSwing ? 0x20 : 0x00;
        cmd[13] = (s.tankWarningLevel || 0) & 0xFF;

        // Last byte is a rolling sequence id (mirrors AC behaviour)
        this._setMessageId = (this._setMessageId + 1) & 0xff || 1;
        cmd[19] = this._setMessageId;

        return cmd;
    }
}

module.exports = {
    DehumidifierDevice,
    APPLIANCE_TYPE_DEHUMIDIFIER,
    MODE_BY_NAME,
    MODE_BY_INDEX,
    FAN_BY_NAME,
    FAN_NAME_BY_VALUE,
};
