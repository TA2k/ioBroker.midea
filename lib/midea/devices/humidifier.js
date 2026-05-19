"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFDResponse } = require("../parsers");

const APPLIANCE_TYPE_HUMIDIFIER = 0xFD;

/** Humidifier mode enum is 1-based on the wire; we store 0-based index in status. */
const MODES = [
    "manual", "auto", "continuous", "living-room", "bed-room", "kitchen", "sleep",
];

/** Old subtype (<= 5) and new subtype (> 5) speed maps from midea-local. */
const SPEEDS_OLD = { 1: "lowest", 40: "low", 60: "medium", 80: "high", 102: "auto", 127: "off" };
const SPEEDS_NEW = { 1: "lowest", 39: "low", 59: "medium", 80: "high", 101: "auto", 127: "off" };
const SCREEN_RAW_TO_NAME = { 0: "bright", 6: "dim", 7: "off" };

let MSG_SERIAL = 0;
function nextMessageId() {
    MSG_SERIAL = (MSG_SERIAL + 1) % 254;
    if (MSG_SERIAL === 0) MSG_SERIAL = 1;
    return MSG_SERIAL;
}

/**
 * 0xFD humidifier. Layout taken from midea-local devices/fd/message.py.
 *  - Query: body_type=0x41, 19-byte payload, msg_type=0x03.
 *  - Set:   body_type=0x48, 21-byte payload, msg_type=0x02.
 * Both append a 1-byte message id; createCommand() then adds CRC8 + 0xAA frame.
 */
class HumidifierDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.subtype = Number(opts.applianceSubType || opts.subtype || 0);
    }

    get applianceType() { return APPLIANCE_TYPE_HUMIDIFIER; }

    get _speedMap() {
        return this.subtype > 5 ? SPEEDS_NEW : SPEEDS_OLD;
    }

    async refreshCapabilities() {
        return null;
    }

    async refreshStatus() {
        const inner = Buffer.from([
            0x41,
            0x81, 0x00, 0xFF, 0x03, 0x00, 0x00, 0x02, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            nextMessageId(),
        ]);
        const cmd = createCommand(inner, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HUMIDIFIER,
            addCrc: true,
        });
        this.log.debug(`FD[${this.id}]: refreshStatus() -> sending query`);
        const reply = await this._request(cmd, "getStatus");
        const inner2 = reply.subarray(10, reply.length - 1);
        const parsed = parseFDResponse(inner2);
        this._mergeStatus(this._normalize(parsed));
        return this.status;
    }

    async setStatus(updates = {}) {
        /** @type {any} */
        const s = { ...this.status };
        if (updates.powerOn !== undefined) s.powerOn = !!updates.powerOn;
        if (updates.promptTone !== undefined) s.promptTone = !!updates.promptTone;
        if (updates.disinfect !== undefined) {
            s.disinfect = updates.disinfect === null ? null : !!updates.disinfect;
        }
        if (updates.targetHumidity !== undefined) {
            const v = Math.max(0, Math.min(100, Number(updates.targetHumidity)));
            s.targetHumidity = v;
        }
        if (updates.mode !== undefined) {
            const idx = typeof updates.mode === "string" ? MODES.indexOf(updates.mode) : Number(updates.mode);
            if (idx < 0 || idx >= MODES.length) throw new Error(`FD[${this.id}]: invalid mode '${updates.mode}'`);
            s.modeIndex = idx;
        }
        if (updates.fanSpeed !== undefined) {
            const map = this._speedMap;
            const reverse = Object.fromEntries(Object.entries(map).map(([raw, name]) => [name, Number(raw)]));
            const raw = typeof updates.fanSpeed === "string" ? reverse[updates.fanSpeed] : Number(updates.fanSpeed);
            if (raw === undefined || !(raw in map)) {
                throw new Error(`FD[${this.id}]: invalid fanSpeed '${updates.fanSpeed}'`);
            }
            s.fanSpeed = raw;
        }
        if (updates.screenDisplay !== undefined) {
            const reverse = Object.fromEntries(
                Object.entries(SCREEN_RAW_TO_NAME).map(([raw, name]) => [name, Number(raw)]),
            );
            const raw = typeof updates.screenDisplay === "string"
                ? reverse[updates.screenDisplay]
                : Number(updates.screenDisplay);
            if (raw === undefined || !(raw in SCREEN_RAW_TO_NAME)) {
                throw new Error(`FD[${this.id}]: invalid screenDisplay '${updates.screenDisplay}'`);
            }
            s.screenDisplay = raw;
        }

        const body = this._buildSetBody(s);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_HUMIDIFIER,
            addCrc: true,
        });
        this.log.debug(`FD[${this.id}]: setStatus(${JSON.stringify(updates)}) -> body=${body.toString("hex")}`);
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            const parsed = parseFDResponse(inner);
            this._mergeStatus(this._normalize(parsed));
        } catch (err) {
            this.log.debug(`FD[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }

    _normalize(raw) {
        const out = { ...raw };
        if (raw.modeIndex !== undefined) {
            // Wire value is 1-based mode (1..7) -> array index 0..6.
            const idx = raw.modeIndex - 1;
            out.mode = idx >= 0 && idx < MODES.length ? MODES[idx] : null;
        }
        if (raw.fanSpeed !== undefined) {
            out.fanSpeedName = this._speedMap[raw.fanSpeed] || null;
        }
        if (raw.screenDisplay !== undefined) {
            out.screenDisplayName = SCREEN_RAW_TO_NAME[raw.screenDisplay] || null;
        }
        return out;
    }

    _buildSetBody(s) {
        const power = s.powerOn ? 0x01 : 0x00;
        const promptTone = s.promptTone ? 0x40 : 0x00;
        const fanSpeed = s.fanSpeed !== undefined ? s.fanSpeed : 40;
        const targetHumidity = s.targetHumidity !== undefined ? s.targetHumidity : 50;
        const screenDisplay = s.screenDisplay !== undefined ? s.screenDisplay : 0x07;
        const mode = s.modeIndex !== undefined ? s.modeIndex + 1 : 0x01; // 1-based on the wire
        let disinfect = 0;
        if (s.disinfect === true) disinfect = 1;
        else if (s.disinfect === false) disinfect = 2;
        // body_type 0x48 + 21-byte _body + message_id; createCommand appends CRC8.
        return Buffer.from([
            0x48,
            power | promptTone | 0x02,
            0x00,
            fanSpeed,
            0x00, 0x00, 0x00,
            targetHumidity,
            0x00,
            screenDisplay,
            mode,
            0x00, 0x00, 0x00, 0x00,
            disinfect,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            nextMessageId(),
        ]);
    }
}

module.exports = {
    HumidifierDevice,
    APPLIANCE_TYPE_HUMIDIFIER,
    HUMIDIFIER_MODES: MODES,
    HUMIDIFIER_SPEEDS_OLD: Object.values(SPEEDS_OLD),
    HUMIDIFIER_SPEEDS_NEW: Object.values(SPEEDS_NEW),
    HUMIDIFIER_SCREEN_DISPLAYS: Object.values(SCREEN_RAW_TO_NAME),
};
