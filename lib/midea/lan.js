"use strict";

const net = require("net");
const EventEmitter = require("events");

const sec = require("./security");
const { makeLogger } = require("./logger");

const TCP_PORT = 6444;
const CONNECT_TIMEOUT_MS = 5000;
// 4 s was too tight for some firmware revisions (e.g. PortaSplit
// PT_AC). The device reliably answers getStatus, just not always
// within the legacy budget — the late C0 reply then shows up on the
// next command's read window and confuses the parser. Give it 10 s.
const COMMAND_TIMEOUT_MS = 10000;
const POST_AUTH_DELAY_MS = 250;
const HEARTBEAT_INTERVAL_MS = 10000; // midea-local SOCKET_TIMEOUT
const TCP_KEEPALIVE_DELAY_MS = 10000;
// Keep the authenticated TCP session alive far longer now that we send real
// 5A5A heartbeats. Several AC firmwares accept frequent V3 handshakes but then
// intermittently ignore the first encrypted command on a freshly opened
// session; holding one warm session avoids repeatedly re-taking the device's
// single LAN-client slot. midea-local keeps the session open indefinitely and
// relies on the heartbeat.
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * LAN client for Midea V1, V2 and V3 appliances. One instance per device.
 *
 * V3 (default): TCP connect → 8370 token handshake → encrypted command frames
 * (AES-256-CBC + HMAC-SHA-256). Requires `token` and `key` from the cloud.
 *
 * V1/V2: TCP connect → raw 5a5a packets (AES-128-ECB + MD5 checksum). No
 * authentication, no per-session key. `token`/`key` are not used.
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

        const protocol = opts.protocol == null ? 3 : Number(opts.protocol);
        if (protocol !== 1 && protocol !== 2 && protocol !== 3) {
            throw new Error(`LanClient: unsupported protocol ${opts.protocol}`);
        }
        if (protocol === 3 && (!opts.token || !opts.key)) {
            throw new Error("LanClient: token and key are required for V3 LAN protocol");
        }

        this.host = opts.host;
        this.port = opts.port || TCP_PORT;
        this.deviceId = String(opts.deviceId);
        this.protocol = protocol;
        if (protocol === 3) {
            this.token = Buffer.from(opts.token, "hex");
            this.key = Buffer.from(opts.key, "hex");
        }
        this.log = makeLogger(opts.logger);

        this._socket = null;
        this._connected = false;
        this._tcpKey = null;
        // Whether we've ever successfully authenticated with this client.
        // The first handshake is logged at INFO so users see "device is
        // alive" once after start; every subsequent reconnect drops to
        // DEBUG to avoid spamming the log every poll cycle.
        this._loggedAuthOnce = false;
        this._requestCount = 0;
        this._messageId = 0;
        this._rxBuf = Buffer.alloc(0);
        this._queue = [];
        this._inFlight = null;
        this._cmdTimer = null;
        this._heartbeatTimer = null;
        this._idleCloseTimer = null;
        this._lastActivity = 0;
        this._lastInboundActivity = 0;
    }

    /**
     * True when the socket is up and we've received *any* frame from the
     * appliance within `maxAgeMs`. The device layer uses this to keep a
     * device marked online through a transient command timeout as long as
     * the session is still visibly alive (late replies, heartbeats, pushes).
     *
     * @param {number} maxAgeMs
     * @returns {boolean}
     */
    hasRecentInboundActivity(maxAgeMs) {
        return !!(
            this._socket
            && this._connected
            && this._lastInboundActivity
            && Date.now() - this._lastInboundActivity <= maxAgeMs
        );
    }

    updateCredentials(token, key) {
        if (this.protocol !== 3) return;
        this.token = Buffer.from(token, "hex");
        this.key = Buffer.from(key, "hex");
        this._tcpKey = null;
        this._destroySocket();
    }

    /**
     * Send a 0xAA-framed command and resolve with the full decrypted reply
     * frame (10-byte header + body + 1-byte checksum). The caller is
     * responsible for slicing — see `BaseDevice._processFrame` which slices
     * `frame.subarray(10, frame.length - 1)` to get the inner body. Throws
     * on timeout or transport errors.
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
        // Try a graceful half-close first (FIN, then socket.destroy after a
        // short grace). Some Midea firmware seems to hold the "one TCP
        // control session" slot open until it explicitly receives a FIN;
        // a bare RST from socket.destroy() leaves the slot occupied and
        // the next adapter start then can't send encrypted commands even
        // though the handshake still works. `end()` writes FIN and lets
        // the peer close cleanly. If the socket refuses to close within
        // the grace window we still hard-destroy.
        //
        // We DON'T call _destroySocket() straight away here because that
        // would set this._socket = null and skip the actual FIN flush.
        // Instead: null out our reference (so no more traffic queues to
        // this socket), clear the auth/timers, then let end()+delayed
        // destroy() take care of the transport half.
        const sock = this._socket;
        this._socket = null;
        this._connected = false;
        this._tcpKey = null;
        this._loggedAuthOnce = false;
        this._rxBuf = Buffer.alloc(0);
        if (this._cmdTimer) { clearTimeout(this._cmdTimer); this._cmdTimer = null; }
        this._stopHeartbeat();
        if (this._idleCloseTimer) { clearTimeout(this._idleCloseTimer); this._idleCloseTimer = null; }
        if (sock) {
            try { sock.end(); } catch (_e) { /* swallow */ }
            setTimeout(() => {
                try { sock.destroy(); } catch (_e) { /* swallow */ }
            }, 500).unref();
        }
    }

    async _pump() {
        if (this._inFlight || this._queue.length === 0) return;
        this._inFlight = this._queue.shift();
        this.log.debug(`LanClient[${this.deviceId}]: pump label=${this._inFlight.label} queue=${this._queue.length}`);

        try {
            await this._ensureConnected();
            if (this.protocol === 3) await this._ensureAuthenticated();
            await this._send(this._inFlight);
        } catch (err) {
            const item = this._inFlight;
            this._inFlight = null;
            // A command timeout sets err.keepSocket: the appliance sometimes
            // answers *after* our window, and that late reply arrives on the
            // same session. Tearing the socket down would force a fresh
            // handshake (re-taking the single LAN slot) and drop the late
            // frame. Keep it open and just re-arm the idle timer. Handshake
            // failures and hard transport errors still destroy the socket.
            if (err && err.keepSocket) {
                this.log.debug(`LanClient[${this.deviceId}]: keeping socket open after ${item && item.label} timeout for late replies`);
                this._armIdleClose();
            } else {
                this._destroySocket();
            }
            this.log.debug(`LanClient[${this.deviceId}]: pump error label=${item && item.label} (${err && err.message})`);
            if (item) item.reject(err);
            setImmediate(() => this._pump());
        }
    }

    _ensureConnected() {
        if (this._connected && this._socket) return Promise.resolve();
        this.log.debug(`LanClient[${this.deviceId}]: connecting to ${this.host}:${this.port} (protocol=${this.protocol})`);
        return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
            this._rxBuf = Buffer.alloc(0);
            const sock = net.createConnection(this.port, this.host);
            this._socket = sock;
            // Permanent safety-net error listener. Stays attached for the
            // lifetime of `sock`. Two purposes:
            //   (a) prevents 'error' events from surfacing as
            //       process-level uncaughtException after our other
            //       handlers have been removed (e.g., OS reports
            //       ETIMEDOUT a second after we've moved on);
            //   (b) keeps stray errors from a stale socket — one that
            //       was destroyed but whose 'error' is still buffered —
            //       from poisoning the current pump state.
            sock.on("error", (err) => {
                const isCurrent = sock === this._socket;
                this.log.debug(
                    `LanClient[${this.deviceId}]: ${isCurrent ? "" : "stale "}socket error ${err.message}`,
                );
            });
            // Permanent close listener with identity check. The previous
            // implementation called this._onSocketClose() unconditionally,
            // which let an OLD socket's close event reject a NEW pump's
            // in-flight request — manifesting as "socket closed
            // mid-request" before the new socket had even connected.
            sock.on("close", () => {
                if (sock !== this._socket) return; // stale, ignore
                this._onSocketClose();
            });
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
                reject(
                    new Error(
                        `LanClient: connect timeout to ${this.host}:${this.port} — the appliance is reachable on UDP but TCP/${this.port} is being blocked, or another LAN client (the phone app) is currently connected. Only one TCP control session is allowed at a time.`,
                    ),
                );
            };
            const cleanup = () => {
                clearTimeout(timer);
                sock.removeListener("error", onError);
                sock.removeListener("connect", onConnect);
            };
            const onConnect = () => {
                cleanup();
                this._connected = true;
                this._lastActivity = Date.now();
                try {
                    sock.setKeepAlive(true, TCP_KEEPALIVE_DELAY_MS);
                    sock.setNoDelay(true);
                } catch (_e) { /* swallow */ }
                this.log.debug(`LanClient[${this.deviceId}]: connected`);
                // data listener is identity-checked too — a stale socket
                // pushing data after a new one took over would otherwise
                // be appended to the wrong rx buffer.
                sock.on("data", (d) => { if (sock === this._socket) this._onData(d); });
                this._startHeartbeat();
                this._armIdleClose();
                resolve();
            };
            const timer = setTimeout(onTimeout, CONNECT_TIMEOUT_MS);
            sock.once("error", onError);
            sock.once("connect", onConnect);
        }));
    }

    async _ensureAuthenticated() {
        if (this._tcpKey) return;
        const token = this.token;
        const key = this.key;
        if (!token || !key) {
            throw new Error("LanClient: token and key are required for V3 authentication");
        }
        this.log.debug(`LanClient[${this.deviceId}]: handshake start tokenLen=${token.length}`);
        const frame = sec.encode0x8370(token, sec.MSGTYPE_HANDSHAKE_REQUEST, this._nextRequestCount(), null);
        const response = await this._writeAndAwait(frame, "authenticate", true);
        if (response.length === 5 && response.toString() === "ERROR") {
            throw new Error("LanClient: authenticate ERROR");
        }
        if (response.length !== 64) {
            throw new Error(`LanClient: unexpected authenticate response length ${response.length}`);
        }
        this._tcpKey = sec.deriveTcpKey(response, key);
        // midea-local resets the 8370 encrypted-frame counter after deriving
        // the session key, so the first command on a session carries
        // requestCount 0. Keep the wire sequence identical for strict
        // firmware revisions.
        this._requestCount = 0;
        const msg = `LanClient[${this.deviceId}]: LAN authentication succeeded (tcpKey ${this._tcpKey.length} bytes)`;
        if (this._loggedAuthOnce) {
            this.log.debug(msg);
        } else {
            this.log.info(msg);
            this._loggedAuthOnce = true;
        }
        await new Promise((r) => setTimeout(r, POST_AUTH_DELAY_MS));
    }

    /** @param {{cmd: Buffer, label: string, resolve: Function, reject: Function}} item */
    async _send(item) {
        const inner = sec.aesEcbEncrypt(item.cmd);
        this._messageId = (this._messageId + 1) & 0x7fff || 1;
        let packet = sec.addHeader0x5A5A(inner, this._messageId, this.deviceId);
        packet = sec.appendMd5Checksum(packet);

        let frame;
        if (this.protocol === 3) {
            frame = sec.encode0x8370(packet, sec.MSGTYPE_ENCRYPTED_REQUEST, this._nextRequestCount(), this._tcpKey);
        } else {
            frame = packet;
        }
        this.log.debug(`LanClient[${this.deviceId}]: send label=${item.label} msgId=${this._messageId} cmdBytes=${item.cmd.length} frameBytes=${frame.length}`);
        this.log.debug(`LanClient[${this.deviceId}]: send cmd=${item.cmd.toString("hex")} inner5a5a=${packet.toString("hex")}`);

        const reply = await this._writeAndAwait(frame, item.label, false);
        this.log.debug(`LanClient[${this.deviceId}]: recv label=${item.label} replyBytes=${reply.length} reply=${reply.toString("hex")}`);
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
        this._lastActivity = Date.now();
        this._armIdleClose();
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
                        this.log.debug(
                            `LanClient[${this.deviceId}]: timeout ${label} after ${COMMAND_TIMEOUT_MS}ms, rxBuf=${this._rxBuf.length} bytes${this._rxBuf.length ? " " + this._rxBuf.subarray(0, Math.min(64, this._rxBuf.length)).toString("hex") : ""}`,
                        );
                        const err = new Error(
                            `LanClient: timeout waiting for ${label} — TCP/${this.port} is being blocked, or another LAN client (the phone app) is currently connected. Only one TCP control session is allowed at a time.`,
                        );
                        // For non-handshake commands keep the socket so a late
                        // reply on the same session isn't lost; the pump-error
                        // handler re-arms the idle timer. Handshake timeouts
                        // tear down (a half-open handshake is unrecoverable).
                        err.keepSocket = !isHandshake;
                        r(err);
                    }
                }, COMMAND_TIMEOUT_MS);
            });
        });
    }

    _onData(chunk) {
        this.log.debug(`LanClient[${this.deviceId}]: rx chunk ${chunk.length} bytes ${chunk.subarray(0, Math.min(64, chunk.length)).toString("hex")}${chunk.length > 64 ? "..." : ""}`);
        this._rxBuf = Buffer.concat([this._rxBuf, chunk]);
        this._lastActivity = Date.now();
        this._lastInboundActivity = this._lastActivity;
        // Any inbound byte means the session is alive — used by the device
        // layer to keep online=true through a transient command timeout.
        this.emit("activity", { ts: this._lastInboundActivity });
        if (this.protocol === 3) {
            this._drainV3();
        } else {
            this._drainRaw();
        }
    }

    _drainV3() {
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
            this._handleFrame(frame, true);
        }
    }

    _drainRaw() {
        while (this._rxBuf.length >= 6) {
            if (this._rxBuf[0] !== 0x5a || this._rxBuf[1] !== 0x5a) {
                this.log.warn(`LanClient[${this.deviceId}]: dropped unexpected byte ${this._rxBuf[0].toString(16)}`);
                this._rxBuf = this._rxBuf.subarray(1);
                continue;
            }
            const declared = this._rxBuf.readUInt16LE(4);
            if (declared < 56 || declared > 4096) {
                this.log.warn(`LanClient[${this.deviceId}]: implausible 5a5a length ${declared}, resyncing`);
                this._rxBuf = this._rxBuf.subarray(1);
                continue;
            }
            if (this._rxBuf.length < declared) return;
            const frame = this._rxBuf.subarray(0, declared);
            this._rxBuf = this._rxBuf.subarray(declared);
            this._handleFrame(frame, false);
        }
    }

    _handleFrame(frame, isV3) {
        if (this._cmdTimer) clearTimeout(this._cmdTimer);
        this._cmdTimer = null;

        if (!this._pendingResolve) {
            this._handleUnsolicited(frame, isV3);
            return;
        }

        const resolve = this._pendingResolve;
        const reject = this._pendingReject;
        const handshake = this._pendingIsHandshake;
        this._pendingResolve = null;
        this._pendingReject = null;
        this._pendingIsHandshake = false;

        try {
            if (isV3) {
                const decoded = sec.decode0x8370(frame, handshake ? null : this._tcpKey);
                resolve(decoded.payload);
            } else {
                resolve(frame);
            }
        } catch (err) {
            if (reject) reject(err);
        }
    }

    /**
     * Decode an inbound frame that arrived without a pending request and
     * emit it as a `notify` event so the device class can merge it the same
     * way it would merge a poll/setStatus reply. Mirrors midea-local's
     * single recv loop: every appliance frame is parsed identically.
     * Notifications typically arrive 0.5–1 s after a setStatus, when the
     * appliance pushes its updated state spontaneously.
     */
    _handleUnsolicited(frame, isV3) {
        try {
            let inner;
            if (isV3) {
                if (!this._tcpKey) {
                    this.log.debug(`LanClient[${this.deviceId}]: notify ignored, no tcpKey yet`);
                    return;
                }
                const decoded = sec.decode0x8370(frame, this._tcpKey);
                inner = decoded.payload;
            } else {
                inner = frame;
            }
            if (!inner || inner.length < 56) {
                this.log.debug(`LanClient[${this.deviceId}]: notify too short (${inner ? inner.length : 0} bytes), ignoring`);
                return;
            }
            // 5A5A message-type at [2..3] LE: 0x1001 / 0x0001 are the
            // heartbeat / padding frames the appliance echoes back. They
            // carry no status body — decoding them as a notify would spam
            // the log and confuse parsers. They still counted as inbound
            // activity above, which is all we want from them.
            const payloadType = inner[2] + (inner[3] << 8);
            if (payloadType === 0x1001 || payloadType === 0x0001) {
                this.log.debug(`LanClient[${this.deviceId}]: heartbeat/padding frame ignored`);
                return;
            }
            const body = sec.aesEcbDecrypt(inner.subarray(40, inner.length - 16));
            this.log.debug(`LanClient[${this.deviceId}]: notify ${body.length} bytes ${body.toString("hex")}`);
            this._lastActivity = Date.now();
            this.emit("notify", body);
        } catch (err) {
            this.log.debug(`LanClient[${this.deviceId}]: failed to decode unsolicited frame (${err && err.message}): ${frame.toString("hex")}`);
        }
    }

    _onSocketError(err) {
        this.log.warn(`LanClient[${this.deviceId}]: socket error ${err.message}`);
    }

    _startHeartbeat() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        // midea-local sends a 5A5A heartbeat every SOCKET_TIMEOUT seconds on
        // the authenticated TCP session. TCP keepalive alone does not stop
        // all AC Wi-Fi modules from closing their single LAN-client slot
        // between sparse polls, which is what leaves the next session unable
        // to receive command replies. Send a real heartbeat when the session
        // is otherwise idle.
        this._heartbeatTimer = setInterval(() => {
            const idleFor = Date.now() - this._lastActivity;
            this.log.debug(`LanClient[${this.deviceId}]: heartbeat tick (idle=${idleFor}ms, queue=${this._queue.length}, inFlight=${this._inFlight ? this._inFlight.label : "-"})`);
            this._sendHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
        if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
    }

    /**
     * Send a 5A5A keepalive on the live session, but only when nothing else
     * is in flight or queued (a real command already keeps the slot warm).
     * For V3 the packet is wrapped in the 8370 transport with the session
     * key; V1/V2 send the raw 5A5A. Failure destroys the socket so the next
     * request reconnects cleanly.
     */
    _sendHeartbeat() {
        if (!this._socket || !this._connected) return;
        if (this._inFlight || this._queue.length > 0) return;
        try {
            let frame;
            if (this.protocol === 3) {
                if (!this._tcpKey) return;
                const packet = sec.buildHeartbeat0x5A5A(this.deviceId);
                frame = sec.encode0x8370(packet, sec.MSGTYPE_ENCRYPTED_REQUEST, this._nextRequestCount(), this._tcpKey);
            } else {
                frame = sec.buildHeartbeat0x5A5A(this.deviceId);
            }
            this._socket.write(frame, (err) => {
                if (err) {
                    this.log.debug(`LanClient[${this.deviceId}]: heartbeat send failed (${err.message})`);
                    this._destroySocket();
                    return;
                }
                this._lastActivity = Date.now();
                this.log.debug(`LanClient[${this.deviceId}]: heartbeat sent frameBytes=${frame.length}`);
                this._armIdleClose();
            });
        } catch (err) {
            this.log.debug(`LanClient[${this.deviceId}]: heartbeat failed (${err && err.message})`);
            this._destroySocket();
        }
    }

    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    _armIdleClose() {
        if (this._idleCloseTimer) clearTimeout(this._idleCloseTimer);
        this._idleCloseTimer = setTimeout(() => {
            if (this._inFlight || this._queue.length > 0) {
                this._armIdleClose();
                return;
            }
            const idleFor = Date.now() - this._lastActivity;
            if (idleFor < SESSION_IDLE_TIMEOUT_MS - 1000) {
                this._armIdleClose();
                return;
            }
            this.log.debug(`LanClient[${this.deviceId}]: idle ${idleFor}ms, closing socket`);
            this._destroySocket();
        }, SESSION_IDLE_TIMEOUT_MS);
        if (this._idleCloseTimer.unref) this._idleCloseTimer.unref();
    }

    _onSocketClose() {
        this._connected = false;
        this._tcpKey = null;
        this._socket = null;
        this._rxBuf = Buffer.alloc(0);
        if (this._cmdTimer) clearTimeout(this._cmdTimer);
        this._cmdTimer = null;
        const idleFor = this._lastActivity ? Date.now() - this._lastActivity : -1;
        const where = this._inFlight && this._inFlight.label
            ? ` while waiting for "${this._inFlight.label}"`
            : "";
        const idleNote = idleFor >= 0 ? ` (idle ${idleFor}ms before close)` : "";
        // Common cause is the device dropping the TCP session because another
        // LAN client (typically the phone app) connected, or the network path
        // dropped silently — surface that hint with the device id and the
        // command we were mid-flight on, so users can see which call failed.
        const reason = `LanClient[${this.deviceId}] (${this.host}:${this.port}): connection closed by appliance${where}${idleNote} — usually because another LAN client (the phone app) is connected, the appliance rebooted, or the network path dropped. Only one TCP control session at a time is supported.`;
        if (this._pendingReject) {
            const r = this._pendingReject;
            this._pendingResolve = null;
            this._pendingReject = null;
            r(new Error(reason));
            // _pump's catch will reject _inFlight via the propagated rejection.
            return;
        }
        if (this._inFlight) {
            const it = this._inFlight;
            this._inFlight = null;
            it.reject(new Error(reason));
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
        this._stopHeartbeat();
        if (this._idleCloseTimer) {
            clearTimeout(this._idleCloseTimer);
            this._idleCloseTimer = null;
        }
    }

    _nextRequestCount() {
        // Return the current counter, then advance. After a handshake the
        // counter is 0, so the first encrypted frame carries 0 and the
        // sequence is 0,1,2,… exactly like midea-local. (The old variant
        // pre-incremented and skipped 0, starting at 1.)
        const current = this._requestCount;
        this._requestCount = (this._requestCount + 1) & 0xffff;
        return current;
    }
}

module.exports = { LanClient, TCP_PORT };
