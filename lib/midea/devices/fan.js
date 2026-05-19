"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFAResponse } = require("../parsers");

const APPLIANCE_TYPE_FAN = 0xFA;

/** Mode index (zero-based after midea-local's mode-1 normalization) */
const MODES = [
    "normal", "natural", "sleep", "comfort", "silent", "baby",
    "induction", "circulation", "strong", "soft", "customize", "warm", "smart",
];
const OSCILLATION_ANGLES = ["off", "30", "60", "90", "120", "180", "360"];
const TILTING_ANGLES = ["off", "30", "60", "90", "120", "180", "360", "+60", "-60", "40"];
const OSCILLATION_MODES = ["off", "oscillation", "tilting", "curve-w", "curve-8", "reserved", "both"];

const MAX_FAN_SPEED = 26;

/**
 * 0xFA fan. Layout taken from midea-local devices/fa/message.py.
 * Set body has body_type=0x00 prepended by the 0xAA framework, no inner CRC8.
 * Query has an empty body.
 */
class FanDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.subtype = Number(opts.applianceSubType || opts.subtype || 0);
    }

    get applianceType() { return APPLIANCE_TYPE_FAN; }

    async refreshCapabilities() {
        return null;
    }

    async refreshStatus() {
        const cmd = createCommand(Buffer.alloc(0), {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_FAN,
            addCrc: false,
        });
        this.log.debug(`FA[${this.id}]: refreshStatus() -> sending empty query`);
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(this._normalize(parseFAResponse(inner)));
    }

    async setStatus(updates = {}) {
        /** @type {any} */
        const s = {};
        if (updates.powerOn !== undefined) s.powerOn = !!updates.powerOn;
        if (updates.childLock !== undefined) s.childLock = !!updates.childLock;
        if (updates.mode !== undefined) {
            const idx = typeof updates.mode === "string" ? MODES.indexOf(updates.mode) : Number(updates.mode);
            if (idx < 0 || idx >= MODES.length) throw new Error(`FA[${this.id}]: invalid mode '${updates.mode}'`);
            s.modeIndex = idx;
        }
        if (updates.fanSpeed !== undefined) {
            const v = Math.max(1, Math.min(MAX_FAN_SPEED, Number(updates.fanSpeed)));
            s.fanSpeed = v;
            if (v > 0 && this.status.powerOn === false) s.powerOn = true;
        }
        if (updates.oscillate !== undefined) s.oscillate = !!updates.oscillate;
        if (updates.oscillationMode !== undefined) {
            const idx = typeof updates.oscillationMode === "string"
                ? OSCILLATION_MODES.indexOf(updates.oscillationMode)
                : Number(updates.oscillationMode);
            if (idx < 0) throw new Error(`FA[${this.id}]: invalid oscillationMode '${updates.oscillationMode}'`);
            s.oscillationModeIndex = idx;
            s.oscillate = idx > 0;
        }
        if (updates.oscillationAngle !== undefined) {
            const idx = typeof updates.oscillationAngle === "string"
                ? OSCILLATION_ANGLES.indexOf(updates.oscillationAngle)
                : Number(updates.oscillationAngle);
            if (idx < 0) throw new Error(`FA[${this.id}]: invalid oscillationAngle '${updates.oscillationAngle}'`);
            s.oscillationAngleIndex = idx;
            s.oscillate = idx > 0;
        }
        if (updates.tiltingAngle !== undefined) {
            const idx = typeof updates.tiltingAngle === "string"
                ? TILTING_ANGLES.indexOf(updates.tiltingAngle)
                : Number(updates.tiltingAngle);
            if (idx < 0) throw new Error(`FA[${this.id}]: invalid tiltingAngle '${updates.tiltingAngle}'`);
            s.tiltingAngleIndex = idx;
        }

        const body = this._buildSetBody(s);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_FAN,
            addCrc: false,
        });
        this.log.debug(`FA[${this.id}]: setStatus(${JSON.stringify(updates)}) -> body=${body.toString("hex")}`);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    _normalize(raw) {
        const out = { ...raw };
        if (raw.modeIndex !== undefined) {
            out.mode = MODES[raw.modeIndex] || "unknown";
        }
        if (raw.oscillationAngleIndex !== undefined) {
            out.oscillationAngle = OSCILLATION_ANGLES[raw.oscillationAngleIndex] || null;
        }
        if (raw.oscillationModeIndex !== undefined) {
            out.oscillationMode = OSCILLATION_MODES[raw.oscillationModeIndex] || null;
        }
        if (raw.tiltingAngleIndex !== undefined) {
            out.tiltingAngle = TILTING_ANGLES[raw.tiltingAngleIndex] || null;
        }
        return out;
    }

    /**
     * Build the FA set body. midea-local uses an 18- or 49-byte _body
     * depending on subtype; we prepend body_type=0x00, so total length is
     * 19 (small) or 50 (large).
     */
    _buildSetBody(s) {
        const small = this.subtype >= 1 && (this.subtype <= 0x0A || this.subtype === 0xA1);
        const body = Buffer.alloc(small ? 19 : 50);
        body[0] = 0x00; // body_type
        // Place data starting at offset 1 (so byte indices match midea-local's 0-based body indices).
        // midea-local fills indices 0..17 (small) or 0..48 (large) on the inner _body, where index 0 = first data byte.
        // After our prefix, data byte i goes to body[i+1].
        // Defaults from midea-local:
        body[3 + 1] = 0x80; // _body[3] default = 0x80
        body[7 + 1] = 0x80; // _body[7] default = 0x80
        // _body[13] = 0xFF default exists ONLY in the small variant when subtype != 0x0A.
        if (small && this.subtype !== 0x0A) {
            body[13 + 1] = 0xFF;
        }

        if (s.powerOn !== undefined) body[3 + 1] = s.powerOn ? 1 : 0;
        if (s.childLock !== undefined) body[2 + 1] = s.childLock ? 1 : 2;
        if (s.modeIndex !== undefined) {
            body[3 + 1] = 1 | (((s.modeIndex + 1) << 1) & 0x1E);
        }
        if (s.fanSpeed !== undefined && s.fanSpeed >= 1 && s.fanSpeed <= MAX_FAN_SPEED) {
            body[4 + 1] = s.fanSpeed;
        }
        if (s.oscillate !== undefined) body[7 + 1] = s.oscillate ? 1 : 0;
        if (s.oscillationAngleIndex !== undefined) {
            body[7 + 1] = 1 | body[7 + 1] | ((s.oscillationAngleIndex << 4) & 0x70);
        }
        if (s.oscillationModeIndex !== undefined) {
            body[7 + 1] = 1 | body[7 + 1] | ((s.oscillationModeIndex << 1) & 0x0E);
        }
        if (s.tiltingAngleIndex !== undefined && body.length > (24 + 1)) {
            body[24 + 1] = s.tiltingAngleIndex;
        }
        return body;
    }
}

module.exports = {
    FanDevice,
    APPLIANCE_TYPE_FAN,
    FAN_MODES: MODES,
    FAN_OSCILLATION_ANGLES: OSCILLATION_ANGLES,
    FAN_TILTING_ANGLES: TILTING_ANGLES,
    FAN_OSCILLATION_MODES: OSCILLATION_MODES,
};
