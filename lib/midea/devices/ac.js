"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFrame } = require("../parsers");

const APPLIANCE_TYPE_AC = 0xAC;

const MODE_BY_NAME = { auto: 1, cool: 2, dry: 3, heat: 4, fanonly: 5, customdry: 6 };
const MODE_BY_INDEX = { 1: "auto", 2: "cool", 3: "dry", 4: "heat", 5: "fanonly", 6: "customdry" };
const FAN_BY_NAME = { auto: 102, silent: 20, low: 40, medium: 60, high: 80, full: 100 };
const FAN_NAME_BY_VALUE = { 20: "silent", 40: "low", 60: "medium", 80: "high", 100: "full", 102: "auto" };

const SWING_OFF = 0x30;
const SWING_VERTICAL = 0x3C;
const SWING_HORIZONTAL = 0x33;
const SWING_BOTH = 0x3F;

function clampNumber(v, min, max) {
    if (typeof v !== "number" || Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
}

/**
 * 0xAC residential air conditioner. Query/set/capability handling, with
 * the byte-level encoding lifted from the protocol notes shipped with
 * node-mideahvac and msmart-ng.
 */
class ACDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this._setMessageId = 1;
    }

    get applianceType() { return APPLIANCE_TYPE_AC; }

    async refreshCapabilities() {
        const cmd = createCommand(Buffer.from([0xB5, 0x01, 0x11]), {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshCapabilities() -> sending B5 query`);
        const reply = await this._request(cmd, "getCapabilities");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`AC[${this.id}]: refreshCapabilities() <- type=0x${(parsed.type || 0).toString(16)} more=${parsed.more}`);
        if (parsed.type !== 0xB5) throw new Error(`AC[${this.id}]: unexpected capability response 0x${(parsed.type || 0).toString(16)}`);

        let caps = parsed.capabilities;
        let more = parsed.more;
        let safety = 4;
        while (more && safety-- > 0) {
            const moreCmd = createCommand(Buffer.from([0xB5, 0x01, 0x01, more & 0xff]), {
                msgType: 0x03,
                protocol: 0x03,
                applianceType: APPLIANCE_TYPE_AC,
            });
            this.log.debug(`AC[${this.id}]: refreshCapabilities() -> follow-up B5 (more=${more})`);
            const moreReply = await this._request(moreCmd, "getMoreCapabilities");
            /** @type {any} */
            const moreParsed = parseFrame(moreReply);
            if (moreParsed.type !== 0xB5) break;
            caps = { ...caps, ...moreParsed.capabilities };
            more = moreParsed.more;
        }

        this.capabilities = caps;
        this.log.debug(`AC[${this.id}]: capabilities resolved -> ${Object.keys(caps).filter((k) => caps[k] === true).join(", ")}`);
        this.emit("capabilities", caps);
        return caps;
    }

    async refreshStatus() {
        const body = Buffer.from([
            0x41, 0x81, 0x00, 0xff, 0x03, 0xff,
            0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x03,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x00,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshStatus() -> sending C0 query`);
        const reply = await this._request(cmd, "getStatus");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`AC[${this.id}]: refreshStatus() <- type=0x${(parsed.type || 0).toString(16)} bytes=${reply.length}`);
        if (parsed.type !== 0xC0) throw new Error(`AC[${this.id}]: unexpected status response 0x${(parsed.type || 0).toString(16)}`);

        const status = this._normalizeStatus(parsed.status);
        const merged = this._mergeStatus(status);
        if (Object.keys(merged).length) {
            this.log.debug(`AC[${this.id}]: status changed -> ${JSON.stringify(merged)}`);
        }
        return this.status;
    }

    async refreshPowerUsage() {
        const body = Buffer.from([0x41, 0x21, 0x01, 0x44, 0x00, 0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshPowerUsage() -> sending C1 query`);
        const reply = await this._request(cmd, "getPowerUsage");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`AC[${this.id}]: refreshPowerUsage() <- type=0x${(parsed.type || 0).toString(16)} powerUsage=${parsed.powerUsage}`);
        if (parsed.type !== 0xC1) return null;
        if (typeof parsed.powerUsage === "number") this._mergeStatus({ powerUsage: parsed.powerUsage });
        return parsed.powerUsage;
    }

    /**
     * Toggle the display LCD/LED on the indoor unit. Sent as a dedicated
     * 0x41 query frame instead of through the regular set body — this
     * mirrors how the official app and msmart-ng implement it.
     */
    async toggleDisplay() {
        const body = Buffer.from([
            0x41, 0x61, 0x00, 0xff, 0x02, 0x00,
            0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x03,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x00,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: toggleDisplay() -> sending`);
        const reply = await this._request(cmd, "toggleDisplay");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`AC[${this.id}]: toggleDisplay() <- type=0x${(parsed.type || 0).toString(16)}`);
        if (parsed.type === 0xC0 && parsed.status) {
            this._mergeStatus(this._normalizeStatus(parsed.status));
        }
        return this.status;
    }

    /**
     * Apply one or more changes. Properties not present in `updates` keep
     * the device's last known value, which we read from `this.status` (so
     * a refreshStatus() before issuing a setStatus() is recommended).
     */
    async setStatus(updates = {}) {
        /** @type {any} */
        const status = { ...this.status };

        if (updates.mode !== undefined) {
            const m = typeof updates.mode === "string" ? MODE_BY_NAME[updates.mode] : Number(updates.mode);
            if (!m) throw new Error(`AC[${this.id}]: invalid mode '${updates.mode}'`);
            status._modeIndex = m;
        } else if (status.mode) {
            status._modeIndex = MODE_BY_NAME[status.mode] || 1;
        } else {
            status._modeIndex = 1;
        }

        if (updates.fanSpeed !== undefined) {
            if (typeof updates.fanSpeed === "string") {
                if (FAN_BY_NAME[updates.fanSpeed] === undefined) {
                    throw new Error(`AC[${this.id}]: invalid fanSpeed '${updates.fanSpeed}'`);
                }
                status.fanSpeed = FAN_BY_NAME[updates.fanSpeed];
            } else {
                status.fanSpeed = clampNumber(Number(updates.fanSpeed), 0, 102);
            }
        }
        if (status.fanSpeed === undefined) status.fanSpeed = 102;

        if (updates.powerOn !== undefined) status.powerOn = !!updates.powerOn;
        if (updates.temperatureSetpoint !== undefined) {
            const fahrenheit = updates.temperatureUnit === "fahrenheit" || status.temperatureUnit === 1;
            const min = fahrenheit ? 60 : 16;
            const max = fahrenheit ? 87 : 31;
            const v = Number(updates.temperatureSetpoint);
            if (Number.isNaN(v) || v < min || v > max) {
                throw new Error(`AC[${this.id}]: temperatureSetpoint out of range (${min}-${max})`);
            }
            status.temperatureSetpoint = v;
        }
        if (status.temperatureSetpoint === undefined) status.temperatureSetpoint = 21;

        if (updates.temperatureUnit !== undefined) {
            if (updates.temperatureUnit !== "celsius" && updates.temperatureUnit !== "fahrenheit") {
                throw new Error(`AC[${this.id}]: invalid temperatureUnit`);
            }
            status.temperatureUnit = updates.temperatureUnit === "fahrenheit" ? 1 : 0;
        }
        if (status.temperatureUnit === undefined) status.temperatureUnit = 0;

        if (updates.swing !== undefined) {
            switch (updates.swing) {
                case "off": status._swingByte = SWING_OFF; break;
                case "vertical": status._swingByte = SWING_VERTICAL; break;
                case "horizontal": status._swingByte = SWING_HORIZONTAL; break;
                case "both": status._swingByte = SWING_BOTH; break;
                default: throw new Error(`AC[${this.id}]: invalid swing '${updates.swing}'`);
            }
        } else {
            const ud = !!status.updownFan;
            const lr = !!status.leftrightFan;
            status._swingByte = 0x30 | (ud ? 0x0c : 0x00) | (lr ? 0x03 : 0x00);
        }

        if (updates.ecoMode !== undefined) status.ecoMode = !!updates.ecoMode;
        if (updates.turboMode !== undefined) status.turboMode = !!updates.turboMode;
        if (updates.sleepMode !== undefined) status.sleepMode = !!updates.sleepMode;
        if (updates.purify !== undefined) status.purify = !!updates.purify;
        if (updates.dryClean !== undefined) status.dryClean = !!updates.dryClean;
        if (updates.frostProtection !== undefined) status.frostProtection = !!updates.frostProtection;
        if (updates.beep !== undefined) status._beep = !!updates.beep; else status._beep = true;

        const cmd = createCommand(this._buildSetBody(status), {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: setStatus(${JSON.stringify(updates)}) -> sending 0x40 frame`);
        const reply = await this._request(cmd, "setStatus");
        /** @type {any} */
        const parsed = parseFrame(reply);
        this.log.debug(`AC[${this.id}]: setStatus() <- type=0x${(parsed.type || 0).toString(16)}`);
        if (parsed.type === 0xC0 && parsed.status) {
            this._mergeStatus(this._normalizeStatus(parsed.status));
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
        out.swing = raw.updownFan && raw.leftrightFan
            ? "both"
            : raw.updownFan ? "vertical" : raw.leftrightFan ? "horizontal" : "off";
        return out;
    }

    _buildSetBody(s) {
        const cmd = Buffer.alloc(25);
        cmd[0] = 0x40;

        // Byte 1
        cmd[1] = (s._beep ? 0x40 : 0x00) | 0x02 | (s.powerOn ? 0x01 : 0x00);

        // Byte 2: mode + setpoint
        let setpoint = s.temperatureSetpoint;
        if (s.temperatureUnit === 1 && setpoint > 60) {
            setpoint = Math.ceil(((setpoint - 32) / 1.8) * 2) / 2;
        }
        const half = setpoint % 1 ? 0x10 : 0x00;
        const intDeg = Math.floor(setpoint - 16) & 0x0F;
        cmd[2] = ((s._modeIndex & 0x07) << 5) | half | intDeg;

        // Byte 3: fan speed
        cmd[3] = s.fanSpeed & 0x7F;

        // Bytes 4-6: timers (off — we don't surface timers in this adapter)
        cmd[4] = 0x7F;
        cmd[5] = 0x7F;
        cmd[6] = 0xFF;

        // Byte 7: swing
        cmd[7] = s._swingByte;

        // Byte 8: turboMode legacy bit (older firmware reads turbo from here)
        cmd[8] = s.turboMode ? 0x20 : 0x00;

        // Byte 9: ecoMode / purify / dryClean (selfClean is NOT a byte-9 bit)
        cmd[9] =
            (s.ecoMode ? 0x80 : 0x00) |
            (s.purify ? 0x20 : 0x00) |
            (s.dryClean ? 0x04 : 0x00);

        // Byte 10: temperatureUnit / turboMode / sleepMode
        cmd[10] =
            (s.temperatureUnit ? 0x04 : 0x00) |
            (s.turboMode ? 0x02 : 0x00) |
            (s.sleepMode ? 0x01 : 0x00);

        // Bytes 11-17: sleep curve setpoints — zeroed
        // Byte 18: PMV / setNewTemperature — leave zero
        // Byte 19: humidity setpoint (0 = unchanged)
        cmd[19] = (s.humiditySetpoint || 0) & 0x7F;

        // Byte 20: reserved
        cmd[20] = 0x00;

        // Byte 21: frostProtection
        cmd[21] = s.frostProtection ? 0x80 : 0x00;

        // Byte 22: misc flags
        cmd[22] = 0x80;

        // Byte 23: reserved
        cmd[23] = 0x00;

        // Byte 24: monotonically incrementing message id (last byte before CRC)
        this._setMessageId = (this._setMessageId + 1) & 0xff || 1;
        cmd[24] = this._setMessageId;

        return cmd;
    }
}

module.exports = { ACDevice, APPLIANCE_TYPE_AC, MODE_BY_NAME, MODE_BY_INDEX, FAN_BY_NAME, FAN_NAME_BY_VALUE };
