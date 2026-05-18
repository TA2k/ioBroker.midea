"use strict";

const net = require("net");
const EventEmitter = require("events");

const sec = require("./security");
const { makeLogger } = require("./logger");

const TCP_PORT = 6444;
const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 4000;
const POST_AUTH_DELAY_MS = 250;

/**
 * V3 8370 LAN client. One instance per device. Handles TCP connect,
 * handshake authentication (token + key derive tcpKey), encrypted command
 * exchange, and stream re-assembly.
 *
 * Concurrency model: requests are serialised through a FIFO queue. The TCP
 * socket is opened on demand and closed when the queue drains, mirroring
 * the strategy used by the Midea cloud app.
 */
class LanClient extends EventEmitter {
    constructor(opts) {
        super();
        if (!opts || !opts.host) throw new Error("LanClient: host is required");
        if (!opts.deviceId) throw new Error("LanClient: deviceId is required");
        if (!opts.token || !opts.key) {
            throw new Error("LanClient: token and key are required for V3 LAN protocol");
        }

        this.host = opts.host;
        this.port = opts.port || TCP_PORT;
        this.deviceId = String(opts.deviceId);
        this.token = Buffer.from(opts.token, "hex");
        this.key = Buffer.from(opts.key, "hex");
        this.log = makeLogger(opts.logger);

        this._socket = null;
        this._connected = false;
        this._tcpKey = null;
        this._requestCount = 0;
        this._messageId = 0;
        this._rxBuf = Buffer.alloc(0);
        this._queue = [];
        this._inFlight = null;
        this._cmdTimer = null;
    }

    updateCredentials(token, key) {
        this.token = Buffer.from(token, "hex");
        this.key = Buffer.from(key, "hex");
        this._tcpKey = null;
        this._destroySocket();
    }

    /**
     * Send a 0xAA-framed command and resolve with the inner reply body
     * (10-byte header stripped, 1-byte checksum stripped). Throws on timeout
     * or transport errors.
     */
    request(cmd, label = "request") {
        return new Promise((resolve, reject) => {
            this._queue.push({ cmd, label, resolve, reject });
            this._pump();
        });
    }

    close() {
        for (const item of this._queue) item.reject(new Error("LanClient closed"));
        this._queue = [];
        this._destroySocket();
    }

    async _pump() {
        if (this._inFlight || this._queue.length === 0) return;
        this._inFlight = this._queue.shift();
        this.log.debug(`LanClient[${this.deviceId}]: pump label=${this._inFlight.label} queue=${this._queue.length}`);

        try {
            await this._ensureConnected();
            await this._ensureAuthenticated();
            await this._send(this._inFlight);
        } catch (err) {
            const item = this._inFlight;
            this._inFlight = null;
            this._destroySocket();
            this.log.debug(`LanClient[${this.deviceId}]: pump error label=${item && item.label} (${err && err.message})`);
            if (item) item.reject(err);
            setImmediate(() => this._pump());
        }
    }

    _ensureConnected() {
        if (this._connected && this._socket) return Promise.resolve();
        this.log.debug(`LanClient[${this.deviceId}]: connecting to ${this.host}:${this.port}`);
        return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
            this._rxBuf = Buffer.alloc(0);
            const sock = net.createConnection(this.port, this.host);
            this._socket = sock;
            const onError = (err) => {
                cleanup();
                this._destroySocket();
                this.log.debug(`LanClient[${this.deviceId}]: connect error ${err.message}`);
                reject(err);
            };
            const onTimeout = () => {
                cleanup();
                this._destroySocket();
                this.log.debug(`LanClient[${this.deviceId}]: connect timeout to ${this.host}:${this.port}`);
                reject(new Error(`LanClient: connect timeout to ${this.host}:${this.port}`));
            };
            const cleanup = () => {
                clearTimeout(timer);
                sock.removeListener("error", onError);
                sock.removeListener("connect", onConnect);
            };
            const onConnect = () => {
                cleanup();
                this._connected = true;
                this.log.debug(`LanClient[${this.deviceId}]: connected`);
                sock.on("data", (d) => this._onData(d));
                sock.on("error", (err) => this._onSocketError(err));
                sock.on("close", () => this._onSocketClose());
                resolve();
            };
            const timer = setTimeout(onTimeout, CONNECT_TIMEOUT_MS);
            sock.once("error", onError);
            sock.once("connect", onConnect);
        }));
    }

    async _ensureAuthenticated() {
        if (this._tcpKey) return;
        this.log.debug(`LanClient[${this.deviceId}]: handshake start tokenLen=${this.token.length}`);
        const frame = sec.encode0x8370(this.token, sec.MSGTYPE_HANDSHAKE_REQUEST, this._nextRequestCount(), null);
        const response = await this._writeAndAwait(frame, "authenticate", true);
        if (response.length === 5 && response.toString() === "ERROR") {
            throw new Error("LanClient: authenticate ERROR");
        }
        if (response.length !== 64) {
            throw new Error(`LanClient: unexpected authenticate response length ${response.length}`);
        }
        this._tcpKey = sec.deriveTcpKey(response, this.key);
        this.log.debug(`LanClient[${this.deviceId}]: authenticated, tcpKey derived (${this._tcpKey.length} bytes)`);
        await new Promise((r) => setTimeout(r, POST_AUTH_DELAY_MS));
    }

    /** @param {{cmd: Buffer, label: string, resolve: Function, reject: Function}} item */
    async _send(item) {
        const inner = sec.aesEcbEncrypt(item.cmd);
        this._messageId = (this._messageId + 1) & 0x7fff || 1;
        let packet = sec.addHeader0x5A5A(inner, this._messageId, this.deviceId);
        packet = sec.appendMd5Checksum(packet);
        const frame = sec.encode0x8370(packet, sec.MSGTYPE_ENCRYPTED_REQUEST, this._nextRequestCount(), this._tcpKey);
        this.log.debug(`LanClient[${this.deviceId}]: send label=${item.label} msgId=${this._messageId} cmdBytes=${item.cmd.length} frameBytes=${frame.length}`);

        const reply = await this._writeAndAwait(frame, item.label, false);
        this.log.debug(`LanClient[${this.deviceId}]: recv label=${item.label} replyBytes=${reply.length}`);
        let body;
        try {
            body = sec.aesEcbDecrypt(reply.subarray(40, reply.length - 16));
        } catch (err) {
            this._inFlight = null;
            item.reject(new Error(`LanClient: decrypt failed (${err.message})`));
            this._destroySocket();
            setImmediate(() => this._pump());
            return;
        }

        this._inFlight = null;
        item.resolve(body);
        setImmediate(() => this._pump());
    }

    _writeAndAwait(frame, label, isHandshake) {
        return new Promise((resolve, reject) => {
            if (!this._socket || !this._connected) {
                return reject(new Error("LanClient: not connected"));
            }
            this._pendingResolve = resolve;
            this._pendingReject = reject;
            this._pendingIsHandshake = isHandshake;
            this._socket.write(frame, (err) => {
                if (err) {
                    this._pendingResolve = null;
                    this._pendingReject = null;
                    return reject(err);
                }
                this._cmdTimer = setTimeout(() => {
                    if (this._pendingReject) {
                        const r = this._pendingReject;
                        this._pendingResolve = null;
                        this._pendingReject = null;
                        this._destroySocket();
                        r(new Error(`LanClient: timeout waiting for ${label}`));
                    }
                }, COMMAND_TIMEOUT_MS);
            });
        });
    }

    _onData(chunk) {
        this._rxBuf = Buffer.concat([this._rxBuf, chunk]);
        while (this._rxBuf.length >= 6) {
            if (this._rxBuf[0] !== 0x83 || this._rxBuf[1] !== 0x70) {
                this.log.warn(`LanClient[${this.deviceId}]: dropped unexpected byte ${this._rxBuf[0].toString(16)}`);
                this._rxBuf = this._rxBuf.subarray(1);
                continue;
            }
            const declared = this._rxBuf.readUInt16BE(2) + 8;
            if (this._rxBuf.length < declared) return;
            const frame = this._rxBuf.subarray(0, declared);
            this._rxBuf = this._rxBuf.subarray(declared);
            this._handleFrame(frame);
        }
    }

    _handleFrame(frame) {
        if (this._cmdTimer) clearTimeout(this._cmdTimer);
        this._cmdTimer = null;

        if (!this._pendingResolve) {
            this.log.warn(`LanClient[${this.deviceId}]: unsolicited frame ${frame.toString("hex")}`);
            return;
        }

        const resolve = this._pendingResolve;
        const reject = this._pendingReject;
        const handshake = this._pendingIsHandshake;
        this._pendingResolve = null;
        this._pendingReject = null;
        this._pendingIsHandshake = false;

        try {
            const decoded = sec.decode0x8370(frame, handshake ? null : this._tcpKey);
            resolve(decoded.payload);
        } catch (err) {
            if (reject) reject(err);
        }
    }

    _onSocketError(err) {
        this.log.warn(`LanClient[${this.deviceId}]: socket error ${err.message}`);
    }

    _onSocketClose() {
        this._connected = false;
        this._tcpKey = null;
        this._socket = null;
        this._rxBuf = Buffer.alloc(0);
        if (this._cmdTimer) clearTimeout(this._cmdTimer);
        this._cmdTimer = null;
        if (this._pendingReject) {
            const r = this._pendingReject;
            this._pendingResolve = null;
            this._pendingReject = null;
            r(new Error("LanClient: socket closed"));
            // _pump's catch will reject _inFlight via the propagated rejection.
            return;
        }
        if (this._inFlight) {
            const it = this._inFlight;
            this._inFlight = null;
            it.reject(new Error("LanClient: socket closed mid-request"));
        }
    }

    _destroySocket() {
        if (this._socket) {
            try { this._socket.destroy(); } catch (_e) { /* swallow */ }
        }
        this._connected = false;
        this._tcpKey = null;
        this._socket = null;
        this._rxBuf = Buffer.alloc(0);
        if (this._cmdTimer) clearTimeout(this._cmdTimer);
        this._cmdTimer = null;
    }

    _nextRequestCount() {
        this._requestCount = (this._requestCount + 1) & 0xffff;
        if (this._requestCount === 0) this._requestCount = 1;
        return this._requestCount;
    }
}

module.exports = { LanClient, TCP_PORT };
