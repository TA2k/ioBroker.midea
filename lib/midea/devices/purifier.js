"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFCResponse } = require("../parsers");

const APPLIANCE_TYPE_PURIFIER = 0xFC;

/**
 * Modes are encoded in the high nibble of body[2] in the response. The set
 * message echoes the same raw value back. We expose the human-readable string
 * to scripts and translate both directions in this module.
 */
const MODE_RAW_TO_NAME = {
    0x00: "standby",
    0x10: "auto",
    0x20: "manual",
    0x30: "sleep",
    0x40: "fast",
    0x50: "smoke",
};
const MODE_NAME_TO_RAW = Object.fromEntries(
    Object.entries(MODE_RAW_TO_NAME).map(([raw, name]) => [name, Number(raw)]),
);

/** Fan speed encodings as discovered by midea-local. */
const FAN_RAW_TO_NAME = { 1: "auto", 4: "standby", 39: "low", 59: "medium", 80: "high" };
const FAN_NAME_TO_RAW = Object.fromEntries(
    Object.entries(FAN_RAW_TO_NAME).map(([raw, name]) => [name, Number(raw)]),
);

const SCREEN_RAW_TO_NAME = { 0: "bright", 6: "dim", 7: "off" };
const SCREEN_NAME_TO_RAW = Object.fromEntries(
    Object.entries(SCREEN_RAW_TO_NAME).map(([raw, name]) => [name, Number(raw)]),
);

const DETECT_MODES = ["off", "pm25", "methanal"];

let MSG_SERIAL = 0;
function nextMessageId() {
    MSG_SERIAL = (MSG_SERIAL + 1) % 254;
    if (MSG_SERIAL === 0) MSG_SERIAL = 1;
    return MSG_SERIAL;
}

/**
 * 0xFC purifier. Layout taken from midea-local devices/fc/message.py.
 *  - Query: body_type=0x41, 19-byte payload, msg_type=0x03.
 *  - Set:   body_type=0x48, 20-byte payload, msg_type=0x02.
 * Both append a 1-byte message id, then createCommand() adds the CRC8 and the
 * 0xAA framing as usual.
 */
class PurifierDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.subtype = Number(opts.applianceSubType || opts.subtype || 0);
        // standby_detect [high, low] thresholds (for "switch off when air is clean")
        this.standbyDetect = [40, 20];
    }

    get applianceType() { return APPLIANCE_TYPE_PURIFIER; }

    async refreshCapabilities() {
        return null;
    }

    async refreshStatus() {
        const inner = Buffer.from([
            0x41,
            0x00, 0x00, 0xFF, 0x03, 0x00, 0x00, 0x02, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            nextMessageId(),
        ]);
        const cmd = createCommand(inner, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_PURIFIER,
            addCrc: true,
        });
        this.log.debug(`FC[${this.id}]: refreshStatus() -> sending query`);
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(this._normalize(parseFCResponse(inner)));
    }

    async setStatus(updates = {}) {
        /** @type {any} */
        const s = { ...this.status };
        if (updates.powerOn !== undefined) s.powerOn = !!updates.powerOn;
        if (updates.childLock !== undefined) s.childLock = !!updates.childLock;
        if (updates.anion !== undefined) s.anion = !!updates.anion;
        if (updates.standby !== undefined) s.standby = !!updates.standby;
        if (updates.promptTone !== undefined) s.promptTone = !!updates.promptTone;
        if (updates.mode !== undefined) {
            const raw = typeof updates.mode === "string" ? MODE_NAME_TO_RAW[updates.mode] : Number(updates.mode);
            if (raw === undefined || !(raw in MODE_RAW_TO_NAME)) {
                throw new Error(`FC[${this.id}]: invalid mode '${updates.mode}'`);
            }
            s.modeRaw = raw;
        }
        if (updates.fanSpeed !== undefined) {
            const raw = typeof updates.fanSpeed === "string" ? FAN_NAME_TO_RAW[updates.fanSpeed] : Number(updates.fanSpeed);
            if (raw === undefined || !(raw in FAN_RAW_TO_NAME)) {
                throw new Error(`FC[${this.id}]: invalid fanSpeed '${updates.fanSpeed}'`);
            }
            s.fanSpeed = raw;
        }
        if (updates.screenDisplay !== undefined) {
            const raw = typeof updates.screenDisplay === "string"
                ? SCREEN_NAME_TO_RAW[updates.screenDisplay]
                : Number(updates.screenDisplay);
            if (raw === undefined || !(raw in SCREEN_RAW_TO_NAME)) {
                throw new Error(`FC[${this.id}]: invalid screenDisplay '${updates.screenDisplay}'`);
            }
            s.screenDisplay = raw;
        }
        if (updates.detectMode !== undefined) {
            const idx = typeof updates.detectMode === "string"
                ? DETECT_MODES.indexOf(updates.detectMode)
                : Number(updates.detectMode);
            if (idx < 0 || idx >= DETECT_MODES.length) {
                throw new Error(`FC[${this.id}]: invalid detectMode '${updates.detectMode}'`);
            }
            s.detectModeIndex = idx;
        }

        const body = this._buildSetBody(s);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_PURIFIER,
            addCrc: true,
        });
        this.log.debug(`FC[${this.id}]: setStatus(${JSON.stringify(updates)}) -> body=${body.toString("hex")}`);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    _normalize(raw) {
        const out = { ...raw };
        if (raw.modeRaw !== undefined) {
            out.mode = MODE_RAW_TO_NAME[raw.modeRaw] || null;
        }
        if (raw.fanSpeed !== undefined) {
            out.fanSpeedName = FAN_RAW_TO_NAME[raw.fanSpeed] || null;
        }
        if (raw.screenDisplay !== undefined) {
            out.screenDisplayName = SCREEN_RAW_TO_NAME[raw.screenDisplay] || null;
        }
        if (raw.detectModeIndex !== undefined) {
            // detectModeIndex from parser is 1-based when active, 0 means off.
            out.detectMode = DETECT_MODES[raw.detectModeIndex] || "off";
        }
        return out;
    }

    _buildSetBody(s) {
        const power = s.powerOn ? 0x01 : 0x00;
        const promptTone = s.promptTone ? 0x40 : 0x00;
        const detect = s.detectModeIndex && s.detectModeIndex > 0 ? 0x08 : 0x00;
        const detectMode = s.detectModeIndex && s.detectModeIndex > 0 ? s.detectModeIndex - 1 : 0;
        const childLock = s.childLock ? 0x80 : 0x00;
        const anion = s.anion ? 0x20 : 0x00;
        const mode = s.modeRaw !== undefined ? s.modeRaw : 0x10; // default to auto
        const fanSpeed = s.fanSpeed !== undefined ? s.fanSpeed : 39;
        const screenDisplay = s.screenDisplay !== undefined ? s.screenDisplay : 0;
        let standby = 0x08;
        let standbyHigh = 0;
        let standbyLow = 0;
        if (s.standby) {
            standby = 0x04;
            standbyHigh = this.standbyDetect[0];
            standbyLow = this.standbyDetect[1];
        }
        // body_type 0x48 + 20-byte _body + message_id; createCommand appends CRC8.
        return Buffer.from([
            0x48,
            power | promptTone | detect | 0x02,
            mode,
            fanSpeed,
            0x00, 0x00, 0x00, 0x00,
            childLock,
            screenDisplay,
            anion,
            0x00, 0x00, 0x00,
            detectMode,
            standby,
            standbyHigh,
            standbyLow,
            0x00, 0x00, 0x00,
            nextMessageId(),
        ]);
    }
}

module.exports = {
    PurifierDevice,
    APPLIANCE_TYPE_PURIFIER,
    PURIFIER_MODES: Object.values(MODE_RAW_TO_NAME),
    PURIFIER_FAN_SPEEDS: Object.values(FAN_RAW_TO_NAME),
    PURIFIER_SCREEN_DISPLAYS: Object.values(SCREEN_RAW_TO_NAME),
    PURIFIER_DETECT_MODES: DETECT_MODES,
};
