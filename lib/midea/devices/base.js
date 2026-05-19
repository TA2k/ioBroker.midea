"use strict";

const EventEmitter = require("events");

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
        if (!this.host || !this.token || !this.key) {
            throw new Error(`Device[${this.id}]: missing LAN credentials (host/token/key)`);
        }
        this._lan = new LanClient({
            host: this.host,
            port: this.port,
            deviceId: this.id,
            token: this.token,
            key: this.key,
            logger: this.log,
        });
        return this._lan;
    }

    async _request(cmd, label) {
        const lan = this._ensureLan();
        this.log.debug(`Device[${this.id}]: _request(${label}) cmdHex=${cmd.toString("hex")}`);
        try {
            const reply = await lan.request(cmd, label);
            this.online = true;
            this.log.debug(`Device[${this.id}]: _request(${label}) replyBytes=${reply.length} replyHex=${reply.toString("hex")}`);
            return reply;
        } catch (err) {
            this.online = false;
            this.log.debug(`Device[${this.id}]: _request(${label}) failed: ${err && err.message}`);
            throw err;
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
}

module.exports = { BaseDevice };
