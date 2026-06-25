"use strict";

const EventEmitter = require("node:events");

const { LanClient } = require("../lan");
const { makeLogger } = require("../logger");

/**
 * Common base for all appliance device classes. Wraps a LAN client and
 * provides shared lifecycle helpers (refresh, capability fetch, in-memory
 * status diff). Concrete subclasses must implement:
 *   - applianceType (number)
 *   - buildStatusQuery() => Buffer (raw 0xAA-wrapped frame)
 *   - parseResponse(buffer) => object|null
 *   - buildSetCommand(updates) => Buffer
 */
class BaseDevice extends EventEmitter {
    constructor(opts) {
        super();
        if (!opts) throw new Error("BaseDevice: opts required");
        if (!opts.id) throw new Error("BaseDevice: id required");
        this.id = String(opts.id);
        this.name = opts.name || this.id;
        this.host = opts.host;
        this.port = opts.port;
        this.protocol = opts.protocol == null ? 3 : Number(opts.protocol);
        this.token = opts.token;
        this.key = opts.key;
        this.log = makeLogger(opts.logger);
        this.online = false;
        this.status = {};
        this.capabilities = null;

        this._lan = null;
    }

    /** @returns {number} */
    get applianceType() {
        throw new Error("applianceType must be overridden");
    }

    setLanCredentials(host, token, key, port) {
        this.host = host;
        this.port = port || this.port;
        this.token = token;
        this.key = key;
        if (this._lan) {
            this._lan.host = this.host;
            if (port) this._lan.port = port;
            this._lan.updateCredentials(token, key);
        }
    }

    _ensureLan() {
        if (this._lan) return this._lan;
        if (!this.host) {
            throw new Error(`Device[${this.id}]: missing LAN host`);
        }
        if (this.protocol === 3 && (!this.token || !this.key)) {
            throw new Error(`Device[${this.id}]: missing LAN credentials (token/key) for V3 protocol`);
        }
        this._lan = new LanClient({
            host: this.host,
            port: this.port,
            deviceId: this.id,
            protocol: this.protocol,
            token: this.token,
            key: this.key,
            logger: this.log,
        });
        this._lan.on("notify", (body) => {
            try {
                this._handleNotify(body);
            } catch (err) {
                this.log.debug(`Device[${this.id}]: _handleNotify error ${err && err.message}`);
            }
        });
        return this._lan;
    }

    async _request(cmd, label) {
        const lan = this._ensureLan();
        this.log.debug(`Device[${this.id}]: _request(${label}) cmdHex=${cmd.toString("hex")}`);
        // Single retry on transient transport errors. The most common cause
        // is "another LAN client connected" / "connection closed by appliance"
        // mid-request — the AC drops the TCP session after the phone app
        // reconnects briefly. midea-beautiful-air retries on the same class
        // of failures (lan.py:_retry_request). We retry exactly once: a
        // second failure means the device is genuinely unreachable.
        let attempt = 0;
        for (;;) {
            try {
                const reply = await lan.request(cmd, label);
                this.online = true;
                this.log.debug(`Device[${this.id}]: _request(${label}) replyBytes=${reply.length} replyHex=${reply.toString("hex")}`);
                return reply;
            } catch (err) {
                const msg = (err && err.message) || "";
                const transient = /connection closed by appliance|timeout waiting for|not connected|decrypt failed/i.test(msg);
                if (transient && attempt === 0) {
                    attempt = 1;
                    this.log.debug(`Device[${this.id}]: _request(${label}) transient error, retrying once (${msg})`);
                    continue;
                }
                this.online = false;
                this.log.debug(`Device[${this.id}]: _request(${label}) failed: ${msg}`);
                throw err;
            }
        }
    }

    _mergeStatus(parsed) {
        const updates = {};
        for (const key of Object.keys(parsed)) {
            if (this.status[key] !== parsed[key]) {
                this.status[key] = parsed[key];
                updates[key] = parsed[key];
            }
        }
        if (Object.keys(updates).length) {
            this.log.silly(`Device[${this.id}]: _mergeStatus emit ${JSON.stringify(updates)}`);
            this.emit("status", updates);
        }
        return updates;
    }

    close() {
        if (this._lan) this._lan.close();
        this._lan = null;
    }

    /**
     * Default refresh implementation returns the current cached status.
     * Concrete subclasses override this with the appliance-specific query.
     */
    async refreshStatus() { return this.status; }

    /**
     * Default capability refresh — most subclasses don't expose B5/0xB5
     * capabilities and override this to return null.
     */
    async refreshCapabilities() { return this.capabilities; }

    /**
     * Default setStatus is a no-op for read-only devices. Subclasses with
     * write support override this to send the appropriate set command(s).
     *
     * @param {Record<string, any>} _updates
     */
    async setStatus(_updates = {}) { return this.status; }

    /**
     * Handle an unsolicited push frame from the appliance. The decoded
     * 0xAA frame (10-byte header + body + 1-byte checksum) is passed
     * through the per-device `_processFrame` hook — same dispatch path
     * used by `refreshStatus` and `setStatus` replies, so query, set
     * and notify frames all merge through identical code in every
     * device class. Mirrors midea-local's single recv loop.
     *
     * @param {Buffer} frame decrypted 0xAA frame
     */
    _handleNotify(frame) {
        if (!frame || frame.length < 12) return;
        const msgType = frame[9];
        try {
            const merged = this._processFrame(frame, { source: "notify", msgType });
            if (merged && Object.keys(merged).length) {
                this.log.debug(`Device[${this.id}]: notify merged -> ${JSON.stringify(merged)}`);
            }
        } catch (err) {
            this.log.debug(`Device[${this.id}]: notify parse failed (${err && err.message})`);
        }
    }

    /**
     * Decode the inner body of a 0xAA frame and merge any decoded
     * fields into `this.status`. Called from `_handleNotify` for push
     * frames; concrete subclasses also call it from their `refreshStatus`
     * and `setStatus` reply paths so query/set/notify all share one
     * decoder per device — same architecture as midea-local's
     * `process_message`.
     *
     * The full 0xAA frame is passed (10-byte header + body + 1-byte
     * checksum) so parsers like `parseFrame` that expect the full frame
     * can be used directly. Subclasses that only need the inner body
     * call `frame.subarray(10, frame.length - 1)`.
     *
     * Default implementation is a no-op.
     *
     * @param {Buffer} _frame full 0xAA frame
     * @param {{ source: "query"|"set"|"notify", msgType?: number }} _ctx
     * @returns {Record<string, any>|undefined} merged updates, if any
     */
    _processFrame(_frame, _ctx) { return undefined; }
}

module.exports = { BaseDevice };
