"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");
const { parseFrame, NEW_PROTOCOL_TAGS } = require("../parsers");

const APPLIANCE_TYPE_AC = 0xAC;

const MODE_BY_NAME = { auto: 1, cool: 2, dry: 3, heat: 4, fanonly: 5, customdry: 6 };
const MODE_BY_INDEX = { 1: "auto", 2: "cool", 3: "dry", 4: "heat", 5: "fanonly", 6: "customdry" };
const FAN_BY_NAME = { auto: 102, silent: 20, low: 40, medium: 60, high: 80, full: 100 };
const FAN_NAME_BY_VALUE = { 20: "silent", 40: "low", 60: "medium", 80: "high", 100: "full", 102: "auto" };

const SWING_OFF = 0x30;
const SWING_VERTICAL = 0x3C;
const SWING_HORIZONTAL = 0x33;
const SWING_BOTH = 0x3F;

const FRESH_AIR_PADDING_1 = 8; // fresh_air_1 payload after [power, speed]
const FRESH_AIR_TAIL_2 = 0xFF; // fresh_air_2 trailing byte after [power, speed]

const NEW_PROTOCOL_QUERY_TAGS = [
    NEW_PROTOCOL_TAGS.indirect_wind,
    NEW_PROTOCOL_TAGS.breezeless,
    NEW_PROTOCOL_TAGS.indoor_humidity,
    NEW_PROTOCOL_TAGS.screen_display,
    NEW_PROTOCOL_TAGS.fresh_air_1,
    NEW_PROTOCOL_TAGS.fresh_air_2,
    NEW_PROTOCOL_TAGS.wind_lr_angle,
    NEW_PROTOCOL_TAGS.wind_ud_angle,
];

function packNewProtocolValue(param, value) {
    // FOUR-style pack header: [param-lo, param-hi, length, ...value].
    // Mirrors midea-local MessageNewProtocolSet which calls
    // NewProtocolMessageBody.pack(...) with the default pack_len=4.
    // (B0/B1 *replies* use the FIVE-style [lo, hi, 0x00, length, ...val]
    // layout — that asymmetry is parsed in parsers.js parseBX.)
    return Buffer.concat([Buffer.from([param & 0xFF, (param >> 8) & 0xFF, value.length]), value]);
}

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
        this._powerAnalysisMethod = 3; // PowerFormats.MIXED — midea-local default
        this._unsupportedQueries = new Set(); // P1 #8: skip queries that errored once
    }

    get applianceType() { return APPLIANCE_TYPE_AC; }

    /** Override to override the default power-format heuristic (for unusual firmware). */
    setPowerAnalysisMethod(method) { this._powerAnalysisMethod = method; }

    async refreshCapabilities() {
        const cmd = createCommand(Buffer.from([0xB5, 0x01, 0x11, this._nextSetMessageId()]), {
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
            const moreCmd = createCommand(Buffer.from([0xB5, 0x01, 0x01, more & 0xff, this._nextSetMessageId()]), {
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
            this._nextSetMessageId(),
        ]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x00,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshStatus() -> sending C0 query`);
        const reply = await this._request(cmd, "getStatus");
        this.log.debug(`AC[${this.id}]: refreshStatus() <- bytes=${reply.length}`);
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    async refreshPowerUsage() {
        if (this._unsupportedQueries.has("powerUsage")) return null;
        const body = Buffer.from([0x41, 0x21, 0x01, 0x44, 0x00, 0x01, this._nextSetMessageId()]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshPowerUsage() -> sending C1 query`);
        const reply = await this._request(cmd, "getPowerUsage");
        const merged = this._processFrame(reply, { source: "query", msgType: reply[9] }) || {};
        if (typeof merged.powerUsage !== "number" && typeof this.status.powerUsage !== "number") {
            this._unsupportedQueries.add("powerUsage");
            return null;
        }
        return typeof this.status.powerUsage === "number" ? this.status.powerUsage : null;
    }

    /**
     * Query operating-time counters via 0x41/0x40 sub-body. Returns
     * { electrifyTime, totalOperatingTime, currentOperatingTime } in minutes,
     * or null on unsupported firmware.
     */
    async refreshOperatingTime() {
        if (this._unsupportedQueries.has("operatingTime")) return null;
        const body = Buffer.from([0x41, 0x21, 0x01, 0x40, 0x00, 0x01, this._nextSetMessageId()]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshOperatingTime() -> sending C1/40 query`);
        const reply = await this._request(cmd, "getOperatingTime");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        if (typeof this.status.electrifyTime !== "number") {
            this._unsupportedQueries.add("operatingTime");
            return null;
        }
        return {
            electrifyTime: this.status.electrifyTime,
            totalOperatingTime: this.status.totalOperatingTime,
            currentOperatingTime: this.status.currentOperatingTime,
        };
    }

    /**
     * Indoor-humidity query (0x41/0x45 sub-body). Mirrors
     * MessageHumidityQuery in midea-local. Returns the humidity (0..100) or
     * null when the appliance has no sensor.
     */
    async refreshHumidity() {
        if (this._unsupportedQueries.has("humidity")) return null;
        const body = Buffer.from([0x41, 0x21, 0x01, 0x45, 0x00, 0x01, this._nextSetMessageId()]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshHumidity() -> sending C1/45 query`);
        const reply = await this._request(cmd, "getHumidity");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        if (typeof this.status.indoorHumidity !== "number") {
            this._unsupportedQueries.add("humidity");
            return null;
        }
        return this.status.indoorHumidity;
    }

    /**
     * NewProtocol query (body 0xB1) — fetches indoor humidity, breezeless,
     * indirect-wind, screen-display, fresh-air and L/R + U/D wind angles.
     * Mirrors midea-local MessageNewProtocolQuery.
     */
    async refreshNewProtocol() {
        if (this._unsupportedQueries.has("newProtocol")) return null;
        const params = NEW_PROTOCOL_QUERY_TAGS;
        const buf = Buffer.alloc(1 + params.length * 2);
        buf[0] = params.length;
        for (let i = 0; i < params.length; i++) {
            buf[1 + i * 2] = params[i] & 0xFF;
            buf[2 + i * 2] = (params[i] >> 8) & 0xFF;
        }
        const cmd = createCommand(Buffer.concat([Buffer.from([0xB1]), buf, Buffer.from([this._nextSetMessageId()])]), {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: refreshNewProtocol() -> sending B1 query`);
        const reply = await this._request(cmd, "getNewProtocol");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        // Capability detection must consult this.status, not the _mergeStatus
        // diff: when status hasn't changed since the last poll, the diff is
        // empty even though the device replied successfully. Same pattern
        // used by refreshHumidity / refreshOperatingTime above.
        const haveAny = ["indirectWind", "breezeless", "screenDisplayAlternate",
            "freshAirPower", "windLrAngle", "windUdAngle"]
            .some((k) => this.status[k] !== undefined);
        if (!haveAny) {
            this._unsupportedQueries.add("newProtocol");
            return null;
        }
        return this.status;
    }

    /**
     * NewProtocol set (body 0xB0). `updates` may contain any combination of
     * indirectWind / breezeless / screenDisplayAlternate / freshAirPower /
     * freshAirFanSpeed / windLrAngle / windUdAngle. Mirrors midea-local
     * MessageNewProtocolSet.
     *
     * @param {object} updates
     */
    async setNewProtocol(updates = {}) {
        const packs = [];
        let count = 0;
        if (updates.breezeless !== undefined) {
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.breezeless, Buffer.from([updates.breezeless ? 0x01 : 0x00])));
            count++;
        }
        if (updates.indirectWind !== undefined) {
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.indirect_wind, Buffer.from([updates.indirectWind ? 0x02 : 0x01])));
            count++;
        }
        if (updates.screenDisplayAlternate !== undefined) {
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.screen_display, Buffer.from([updates.screenDisplayAlternate ? 0x64 : 0x00])));
            count++;
        }
        if (updates.freshAirPower !== undefined || updates.freshAirFanSpeed !== undefined) {
            // fresh_air_1/_2 share one wire pack containing both power AND speed,
            // so when the user updates only one of them we must fall back to the
            // last known value of the other — otherwise the omitted field is
            // silently clobbered (power → off when only speed changes; speed → 0
            // when only power changes).
            const powerOn = updates.freshAirPower !== undefined
                ? Boolean(updates.freshAirPower)
                : Boolean(this.status && this.status.freshAirPower);
            const speedRaw = updates.freshAirFanSpeed !== undefined
                ? Number(updates.freshAirFanSpeed)
                : Number((this.status && this.status.freshAirFanSpeed) || 0);
            const power = powerOn ? 0x02 : 0x01;
            const speed = clampNumber(speedRaw, 0, 100) & 0xFF;
            // fresh_air_1: 10-byte payload [power, speed, 8 zeros]
            const tail = Buffer.alloc(FRESH_AIR_PADDING_1, 0);
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.fresh_air_1, Buffer.concat([Buffer.from([power, speed]), tail])));
            // fresh_air_2: 3-byte payload [power, speed, 0xFF]
            const power2 = powerOn ? 0x01 : 0x00;
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.fresh_air_2, Buffer.from([power2, speed, FRESH_AIR_TAIL_2])));
            count += 2;
        }
        if (updates.windLrAngle !== undefined) {
            const angle = clampNumber(Number(updates.windLrAngle), 0, 100) & 0xFF;
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.wind_lr_angle, Buffer.from([angle])));
            count++;
        }
        if (updates.windUdAngle !== undefined) {
            const angle = clampNumber(Number(updates.windUdAngle), 0, 100) & 0xFF;
            packs.push(packNewProtocolValue(NEW_PROTOCOL_TAGS.wind_ud_angle, Buffer.from([angle])));
            count++;
        }
        if (count === 0) return this.status;

        const body = Buffer.concat([
            Buffer.from([0xB0, count]),
            ...packs,
            Buffer.from([this._nextSetMessageId()]),
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: setNewProtocol(${JSON.stringify(updates)}) -> sending B0 frame (count=${count})`);
        const reply = await this._request(cmd, "setNewProtocol");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        return this.status;
    }

    _nextSetMessageId() {
        this._setMessageId = (this._setMessageId + 1) & 0xff || 1;
        return this._setMessageId;
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
            this._nextSetMessageId(),
        ]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x00,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: toggleDisplay() -> sending`);
        const reply = await this._request(cmd, "toggleDisplay");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    /**
     * Apply one or more changes. Properties not present in `updates` keep
     * the device's last known value, which we read from `this.status` (so
     * a refreshStatus() before issuing a setStatus() is recommended).
     */
    async setStatus(updates = {}) {
        // NewProtocol fields are written via a separate 0xB0 frame.
        const newProtoUpdates = {};
        for (const k of ["indirectWind", "breezeless", "screenDisplayAlternate", "freshAirPower", "freshAirFanSpeed", "windLrAngle", "windUdAngle"]) {
            if (updates[k] !== undefined) {
                newProtoUpdates[k] = updates[k];
                delete updates[k];
            }
        }

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

        // Mutex group: boost(turboMode)/sleep/eco/comfort/frost are mutually
        // exclusive on the unit. midea-local clears all five before applying
        // the requested one (devices/ac/__init__.py:446). Skipping this lets
        // the AC silently keep an old flag set together with a new one.
        const mutexKeys = ["turboMode", "sleepMode", "ecoMode", "comfortMode", "frostProtection"];
        const mutexTouched = mutexKeys.some((k) => updates[k] !== undefined);
        if (mutexTouched) {
            for (const k of mutexKeys) status[k] = false;
        }

        if (updates.ecoMode !== undefined) status.ecoMode = !!updates.ecoMode;
        if (updates.turboMode !== undefined) status.turboMode = !!updates.turboMode;
        if (updates.sleepMode !== undefined) status.sleepMode = !!updates.sleepMode;
        if (updates.purify !== undefined) status.purify = !!updates.purify;
        if (updates.dryClean !== undefined) status.dryClean = !!updates.dryClean;
        if (updates.frostProtection !== undefined) status.frostProtection = !!updates.frostProtection;
        if (updates.smartEye !== undefined) status.smartEye = !!updates.smartEye;
        if (updates.auxHeating !== undefined) status.auxHeating = !!updates.auxHeating;
        if (updates.naturalWind !== undefined) status.naturalWind = !!updates.naturalWind;
        if (updates.comfortMode !== undefined) status.comfortMode = !!updates.comfortMode;
        if (updates.beep !== undefined) status._beep = !!updates.beep; else status._beep = true;

        // DRY-mode transition: when leaving DRY the indoor fan stays stuck on
        // the slow dry curve until something explicitly bumps it. midea-local
        // forces fan_speed=AUTO on the outgoing mode-change frame
        // (devices/ac/__init__.py:460). Only kick in when the caller didn't
        // pin a fanSpeed themselves.
        const wasDry = (this.status && this.status.mode === "dry");
        if (updates.mode !== undefined && wasDry && status._modeIndex !== MODE_BY_NAME.dry && updates.fanSpeed === undefined) {
            status.fanSpeed = FAN_BY_NAME.auto;
        }

        const cmd = createCommand(this._buildSetBody(status), {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_AC,
        });
        this.log.debug(`AC[${this.id}]: setStatus(${JSON.stringify(updates)}) -> sending 0x40 frame`);
        const reply = await this._request(cmd, "setStatus");
        this._processFrame(reply, { source: "set", msgType: reply[9] });
        // Apply NewProtocol updates (if any) after the GeneralSet succeeds.
        if (Object.keys(newProtoUpdates).length) {
            try {
                await this.setNewProtocol(newProtoUpdates);
            } catch (err) {
                this.log.warn(`AC[${this.id}]: setNewProtocol failed (${err && err.message})`);
            }
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

    /**
     * Single decoder for every 0xAA frame the device sends — query reply,
     * set reply or unsolicited push. Mirrors midea-local's per-device
     * `process_message` so refresh / set / notify all merge through the
     * same code.
     *
     * @param {Buffer} frame full 0xAA frame
     * @param {{ source: "query"|"set"|"notify", msgType?: number }} ctx
     */
    _processFrame(frame, ctx) {
        if (!frame || frame.length < 12) return undefined;
        /** @type {any} */
        const parsed = parseFrame(frame, this._powerAnalysisMethod);
        if (!parsed || parsed.type == null) return undefined;
        if (parsed.type === 0xBB) {
            // V2/SubProtocol body — not yet decoded. Warn once per device on
            // the first non-notify (i.e. user-triggered) reply so the user
            // can open an issue.
            if (ctx.source !== "notify" && !this._loggedSubprotocol) {
                this._loggedSubprotocol = true;
                this.log.warn(`AC[${this.id}]: device replies with V2/0xBB subprotocol — not yet supported. Please open an issue with this body: ${parsed.raw}`);
            }
            return undefined;
        }
        if (parsed.type === 0xC0 && parsed.status) {
            return this._mergeStatus(this._normalizeStatus(parsed.status));
        }
        if ((parsed.type === 0xB0 || parsed.type === 0xB1) && parsed.status) {
            return this._mergeStatus(parsed.status);
        }
        if (parsed.type === 0xC1) {
            const fields = [
                "powerUsage", "totalEnergyConsumption", "totalOperatingConsumption",
                "currentEnergyConsumption", "realtimePower",
                "electrifyTime", "totalOperatingTime", "currentOperatingTime",
                "indoorHumidity",
            ];
            const m = {};
            for (const k of fields) if (typeof parsed[k] === "number") m[k] = parsed[k];
            return Object.keys(m).length ? this._mergeStatus(m) : undefined;
        }
        return undefined;
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

        // Byte 9: smartEye / dryClean / auxHeating / purify / ecoMode
        cmd[9] =
            (s.ecoMode ? 0x80 : 0x00) |
            (s.purify ? 0x20 : 0x00) |
            (s.auxHeating ? 0x08 : 0x00) |
            (s.dryClean ? 0x04 : 0x00) |
            (s.smartEye ? 0x01 : 0x00);

        // Byte 10: temperatureUnit / turboMode / sleepMode
        cmd[10] =
            (s.temperatureUnit ? 0x04 : 0x00) |
            (s.turboMode ? 0x02 : 0x00) |
            (s.sleepMode ? 0x01 : 0x00);

        // Bytes 11-16: sleep curve setpoints — zeroed
        // Byte 17: naturalWind
        cmd[17] = s.naturalWind ? 0x40 : 0x00;
        // Byte 18: PMV / setNewTemperature — leave zero
        // Byte 19: humidity setpoint (0 = unchanged)
        cmd[19] = (s.humiditySetpoint || 0) & 0x7F;

        // Byte 20: reserved
        cmd[20] = 0x00;

        // Byte 21: frostProtection
        cmd[21] = s.frostProtection ? 0x80 : 0x00;

        // Byte 22: comfortMode
        cmd[22] = s.comfortMode ? 0x01 : 0x00;

        // Byte 23: reserved
        cmd[23] = 0x00;

        // Byte 24: monotonically incrementing message id (last byte before CRC)
        cmd[24] = this._nextSetMessageId();

        return cmd;
    }
}

module.exports = { ACDevice, APPLIANCE_TYPE_AC, MODE_BY_NAME, MODE_BY_INDEX, FAN_BY_NAME, FAN_NAME_BY_VALUE };
