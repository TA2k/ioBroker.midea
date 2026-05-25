"use strict";

const crypto = require("node:crypto");
const axios = require("axios");

const sec = require("./security");
const { makeLogger } = require("./logger");

const DEFAULT_HOST = "mp-prod.appsmb.com";
// SmartHomeCloud iotKey from midea-local — used in the HMAC signature payload.
const SMARTHOME_IOT_KEY = "meicloud";

function strftime() {
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return (
        now.getUTCFullYear() +
        pad(now.getUTCMonth() + 1) +
        pad(now.getUTCDate()) +
        pad(now.getUTCHours()) +
        pad(now.getUTCMinutes()) +
        pad(now.getUTCSeconds())
    );
}

/**
 * V3 cloud client (msmart-style). Used only to (a) enumerate the user's
 * appliances and (b) fetch the per-device {token, key} pair needed for
 * the LAN handshake. After that, all control happens locally.
 */
class CloudClient {
    constructor(opts) {
        if (!opts || !opts.user) throw new Error("CloudClient: user (account) required");
        if (!opts.password) throw new Error("CloudClient: password required");

        this.user = opts.user;
        this.password = opts.password;
        this.host = opts.host || DEFAULT_HOST;
        this.appKey = opts.appKey || sec.DEFAULT_APP_KEY;
        // Deterministic per-account client deviceId, matching midea-local. Using
        // a stable id avoids the cloud associating each adapter restart with a
        // fresh client and rejecting later getToken lookups (3004).
        this.deviceId = opts.deviceId || crypto.createHash("sha256").update(`Hello, ${opts.user}!`).digest("hex").slice(0, 16);
        this.log = makeLogger(opts.logger);

        this._iotKey = opts.iotKey || SMARTHOME_IOT_KEY;
        this._rerouted = false;
        this._loginId = null;
        this._accessToken = "";
        this._uid = null;
        this._authPromise = null;
    }

    async _apiRequest(path, payload) {
        const body = JSON.stringify(payload);
        const random = crypto.randomBytes(16).toString("hex");
        const signature = sec.signCloudPayload(body, random);

        const url = `https://${this.host}/mas/v5/app/proxy?alias=${path}`;
        const headers = {
            sign: signature,
            secretVersion: "1",
            random,
            "Content-Type": "application/json",
            accessToken: this._accessToken || "",
            "x-recipe-app": "1010",
        };

        this.log.debug(`CloudClient: POST ${path} bodyLen=${body.length} hasToken=${!!this._accessToken}`);

        let response;
        try {
            response = await axios.post(url, body, { headers, timeout: 15000 });
        } catch (err) {
            const cause = err.response ? `${err.response.status} ${err.response.statusText}` : err.message;
            this.log.debug(`CloudClient: ${path} HTTP failure (${cause})`);
            throw new Error(`CloudClient: HTTP error (${cause})`, { cause: err });
        }
        const data = response.data;
        if (!data || typeof data !== "object") {
            throw new Error("CloudClient: invalid JSON response");
        }
        const code = parseInt(data.code, 10);
        this.log.debug(`CloudClient: ${path} reply code=${code} msg=${data.msg || "ok"}`);
        if (code === 0) return data;

        const msg = data.msg || "unknown";
        switch (code) {
            case 30005: throw new Error(`CloudClient: invalid argument (${msg})`);
            case 40001: this._accessToken = ""; throw new Error("CloudClient: missing access token");
            case 40404: throw new Error(`CloudClient: route not found (${msg})`);
            case 44003: throw new Error("CloudClient: bad signature");
            default: throw new Error(`CloudClient: ${msg} (code=${code})`);
        }
    }

    /**
     * MSmartHome multi-region routing. The cloud assigns each user account to a
     * regional MAS server; LAN-token bindings live only on that regional server.
     * Without the re-route, listAppliances often still works (federated), but
     * /v1/iot/secure/getToken returns 3004 because the udpId is unknown on the
     * default host. Mirrors midea-local SmartHomeCloud._re_route.
     */
    async _reRoute() {
        if (this._rerouted) return;
        try {
            const data = await this._apiRequest("/v1/multicloud/platform/user/route", {
                appId: "1010",
                format: 2,
                clientType: 1,
                language: "en_US",
                src: "1010",
                stamp: strftime(),
                platformId: "1",
                deviceId: this.deviceId,
                reqId: crypto.randomBytes(16).toString("hex"),
                userType: "0",
                userName: this.user,
            });
            const masUrl = data && data.data && data.data.masUrl;
            if (masUrl) {
                let newHost = null;
                try {
                    newHost = new URL(masUrl).host;
                } catch (_) {
                    newHost = masUrl.replace(/^https?:\/\//, "").split("/")[0];
                }
                if (newHost && newHost !== this.host) {
                    this.log.info(`CloudClient: regional re-route ${this.host} -> ${newHost}`);
                    this.host = newHost;
                } else {
                    this.log.debug(`CloudClient: re-route confirmed ${this.host}`);
                }
            } else {
                this.log.debug("CloudClient: re-route returned no masUrl — keeping default host");
            }
        } catch (err) {
            this.log.debug(`CloudClient: re-route failed (${err.message}) — keeping default host`);
        } finally {
            this._rerouted = true;
        }
    }

    async _getLoginId() {
        const data = await this._apiRequest("/v1/user/login/id/get", {
            appId: "1010",
            format: 2,
            clientType: 1,
            language: "en_US",
            src: "1010",
            stamp: strftime(),
            deviceId: this.deviceId,
            reqId: crypto.randomBytes(16).toString("hex"),
            loginAccount: this.user,
        });
        this._loginId = data.data.loginId;
        return this._loginId;
    }

    async authenticate() {
        if (this._accessToken) return this._accessToken;
        if (this._authPromise) return this._authPromise;

        this._authPromise = (async () => {
            try {
                await this._reRoute();
                if (!this._loginId) await this._getLoginId();
                const data = await this._apiRequest("/mj/user/login", {
                    appId: "1010",
                    format: 2,
                    clientType: 1,
                    language: "en_US",
                    src: "1010",
                    stamp: strftime(),
                    reqId: crypto.randomBytes(16).toString("hex"),
                    data: {
                        appKey: this.appKey,
                        deviceId: this.deviceId,
                        platform: 2,
                    },
                    iotData: {
                        appId: "1010",
                        clientType: 1,
                        iampwd: sec.encryptIamPassword(this.appKey, this._loginId, this.password),
                        loginAccount: this.user,
                        password: sec.encryptPassword(this.appKey, this._loginId, this.password),
                        pushToken: crypto.randomBytes(120).toString("base64"),
                        reqId: crypto.randomBytes(16).toString("hex"),
                        src: "1010",
                        stamp: strftime(),
                    },
                });
                this._accessToken = data.data.mdata.accessToken;
                this._uid = (data.data.mdata && data.data.mdata.uid) || (data.data && data.data.uid) || null;
                this.log.debug(`CloudClient: authenticated (uid=${this._uid || "none"})`);
                return this._accessToken;
            } finally {
                this._authPromise = null;
            }
        })();
        return this._authPromise;
    }

    /**
     * Fetch all candidate token/key pairs for a device id, one per udpId
     * method (LITTLE, BIG) that the cloud actually has an entry for. Returned
     * in preference order — caller should try LAN-authenticate with each in
     * turn until one works (mirrors midea-beautiful-air's lan.py:735-748).
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<Array<{method: string, token: string, key: string}>>}
     */
    async getTokenCandidates(deviceId) {
        await this.authenticate();
        const methods = [
            { name: "LITTLE", id: sec.UDP_ID_METHODS.LITTLE },
            { name: "BIG", id: sec.UDP_ID_METHODS.BIG },
        ];
        const candidates = [];
        const stats = [];
        const errors = [];
        for (const m of methods) {
            const udpId = sec.deriveUdpId(deviceId, m.id);
            this.log.debug(`getToken[${deviceId}]: try ${m.name} udpId=${udpId} — request token+key from cloud`);
            let data;
            try {
                data = await this._apiRequest("/v1/iot/secure/getToken", {
                    appId: "1010",
                    src: "1010",
                    format: 2,
                    clientType: 1,
                    language: "en_US",
                    deviceId: this.deviceId,
                    stamp: strftime(),
                    reqId: crypto.randomBytes(16).toString("hex"),
                    udpid: udpId,
                });
            } catch (err) {
                stats.push(`${m.name}=err`);
                errors.push(`${m.name}: ${err && err.message ? err.message : err}`);
                this.log.debug(`getToken[${deviceId}]: ${m.name} udpId=${udpId} rejected by cloud (${err && err.message ? err.message : err}) — falling through to next method`);
                continue;
            }
            const list = (data.data && data.data.tokenlist) || [];
            stats.push(`${m.name}=${list.length}`);
            let matched = null;
            for (const pair of list) {
                if (pair.udpId === udpId) {
                    matched = pair;
                    break;
                }
            }
            if (matched) {
                candidates.push({ method: m.name, token: matched.token, key: matched.key });
                this.log.debug(`getToken[${deviceId}]: ${m.name} udpId=${udpId} received successfully — token=${matched.token.slice(0, 8)}…, key=${matched.key.slice(0, 8)}…`);
            } else {
                this.log.debug(`getToken[${deviceId}]: ${m.name} udpId=${udpId} not in tokenlist (cloud returned ${list.length} entries) — falling through to next method`);
            }
        }
        this.log.debug(`getToken[${deviceId}]: done — ${candidates.length} candidate(s) [${stats.join(", ")}]`);
        if (!candidates.length && errors.length === methods.length) {
            throw new Error(`CloudClient: getToken failed for deviceId=${deviceId} on all methods (${errors.join("; ")})`);
        }
        return candidates;
    }

    /**
     * Convenience wrapper returning the first candidate (LITTLE preferred).
     * Throws if no method matches. Use getTokenCandidates() when you can
     * try-and-fall-back via the LAN handshake.
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<{token: string, key: string}>}
     */
    async getToken(deviceId) {
        const candidates = await this.getTokenCandidates(deviceId);
        if (!candidates.length) {
            throw new Error(`CloudClient: no token/key pair found for deviceId=${deviceId}`);
        }
        return { token: candidates[0].token, key: candidates[0].key };
    }

    /**
     * List the appliances bound to the user account.
     */
    async listAppliances() {
        await this.authenticate();
        this.log.debug("CloudClient: listAppliances()");
        const data = await this._apiRequest("/v1/appliance/user/list/get", {
            appId: "1010",
            format: 2,
            clientType: 1,
            language: "en_US",
            src: "1010",
            stamp: strftime(),
            reqId: crypto.randomBytes(16).toString("hex"),
        });
        const list = (data.data && data.data.list) || [];
        this.log.debug(`CloudClient: listAppliances -> ${list.length} appliance(s)`);
        return list.map((it) => ({
            id: String(it.id),
            name: it.name,
            type: typeof it.type === "string" ? parseInt(it.type, 16) : Number(it.type),
            modelNumber: it.modelNumber,
            sn: it.sn,
            online: it.onlineStatus === "1" || it.onlineStatus === 1,
        }));
    }
}

/**
 * V1 app catalog (NetHome Plus, Midea Air, Ariston Clima). All three speak
 * the same legacy `mapp.appsmb.com` protocol — only appKey/appId differ.
 */
const V1_APPS = {
    nethome: {
        appKey: "3742e9e5842d4ad59c2db887e12449f9",
        appId: "1017",
        host: "mapp.appsmb.com",
    },
    "midea-air": {
        appKey: "ff0cf6f5f0c3471de36341cab3f7a9af",
        appId: "1117",
        host: "mapp.appsmb.com",
    },
    "ariston-clima": {
        appKey: "434a209a5ce141c3b726de067835d7f0",
        appId: "1005",
        host: "mapp.appsmb.com",
    },
};

/**
 * V1 cloud client (NetHome Plus / Midea Air / Ariston Clima). Form-urlencoded,
 * sha256(urlPath + sorted(form) + appKey) signature, no HMAC. Returns the same
 * { token, key } pair as the V3 cloud — the LAN handshake afterwards is
 * identical for V3 firmware appliances regardless of where they were bound.
 */
class CloudClientV1 {
    constructor(opts) {
        if (!opts || !opts.user) throw new Error("CloudClientV1: user (account) required");
        if (!opts.password) throw new Error("CloudClientV1: password required");
        const appKey = opts.appName && V1_APPS[opts.appName] ? V1_APPS[opts.appName] : V1_APPS.nethome;
        this.appName = opts.appName || "nethome";
        this.user = opts.user;
        this.password = opts.password;
        this.host = opts.host || appKey.host;
        this.appKey = opts.appKey || appKey.appKey;
        this.appId = opts.appId || appKey.appId;
        this.deviceId = opts.deviceId || crypto.createHash("sha256").update(`Hello, ${opts.user}!`).digest("hex").slice(0, 16);
        this.log = makeLogger(opts.logger);

        this._loginId = null;
        this._accessToken = "";
        this._sessionId = null;
        this._uid = null;
        this._authPromise = null;
    }

    _generalData(extra = {}) {
        const base = {
            src: this.appId,
            format: "2",
            stamp: strftime(),
            deviceId: this.deviceId,
            reqId: crypto.randomBytes(16).toString("hex"),
            clientType: "1",
            appId: this.appId,
        };
        if (this._sessionId) base.sessionId = this._sessionId;
        return Object.assign(base, extra);
    }

    async _apiRequest(endpoint, fields) {
        const data = this._generalData(fields);
        data.sign = sec.signMideaAir(endpoint, data, this.appKey);
        const url = `https://${this.host}${endpoint}`;
        const headers = { "Content-Type": "application/x-www-form-urlencoded" };
        if (this._uid) headers.uid = this._uid;
        if (this._accessToken) headers.accessToken = this._accessToken;

        this.log.debug(`CloudClientV1: POST ${endpoint} hasToken=${!!this._accessToken}`);

        let response;
        try {
            response = await axios.post(url, new URLSearchParams(data).toString(), { headers, timeout: 15000 });
        } catch (err) {
            const cause = err.response ? `${err.response.status} ${err.response.statusText}` : err.message;
            throw new Error(`CloudClientV1: HTTP error (${cause})`, { cause: err });
        }
        const body = response.data;
        if (!body || typeof body !== "object") throw new Error("CloudClientV1: invalid JSON response");
        const code = parseInt(body.errorCode, 10);
        if (code === 0) return body.result || {};
        throw new Error(`CloudClientV1: ${body.msg || "unknown"} (errorCode=${code})`);
    }

    async _getLoginId() {
        const result = await this._apiRequest("/v1/user/login/id/get", { loginAccount: this.user });
        this._loginId = result.loginId;
        return this._loginId;
    }

    async authenticate() {
        if (this._accessToken) return this._accessToken;
        if (this._authPromise) return this._authPromise;

        this._authPromise = (async () => {
            try {
                if (!this._loginId) await this._getLoginId();
                const result = await this._apiRequest("/v1/user/login", {
                    loginAccount: this.user,
                    password: sec.encryptPassword(this.appKey, this._loginId, this.password),
                });
                this._accessToken = result.accessToken;
                this._uid = result.userId;
                this._sessionId = result.sessionId;
                this.log.debug(`CloudClientV1: authenticated (app=${this.appName})`);
                return this._accessToken;
            } finally {
                this._authPromise = null;
            }
        })();
        return this._authPromise;
    }

    /**
     * Fetch all candidate token/key pairs for a device id. See
     * CloudClient.getTokenCandidates for semantics.
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<Array<{method: string, token: string, key: string}>>}
     */
    async getTokenCandidates(deviceId) {
        await this.authenticate();
        const methods = [
            { name: "LITTLE", id: sec.UDP_ID_METHODS.LITTLE },
            { name: "BIG", id: sec.UDP_ID_METHODS.BIG },
        ];
        const candidates = [];
        const stats = [];
        const errors = [];
        for (const m of methods) {
            const udpId = sec.deriveUdpId(deviceId, m.id);
            this.log.debug(`getToken[${deviceId}] (V1): try ${m.name} udpId=${udpId} — request token+key from cloud`);
            let result;
            try {
                result = await this._apiRequest("/v1/iot/secure/getToken", { udpid: udpId });
            } catch (err) {
                stats.push(`${m.name}=err`);
                errors.push(`${m.name}: ${err && err.message ? err.message : err}`);
                this.log.debug(`getToken[${deviceId}] (V1): ${m.name} udpId=${udpId} rejected by cloud (${err && err.message ? err.message : err}) — falling through to next method`);
                continue;
            }
            const list = result.tokenlist || [];
            stats.push(`${m.name}=${list.length}`);
            let matched = null;
            for (const pair of list) {
                if (pair.udpId === udpId) {
                    matched = pair;
                    break;
                }
            }
            if (matched) {
                candidates.push({ method: m.name, token: matched.token, key: matched.key });
                this.log.debug(`getToken[${deviceId}] (V1): ${m.name} udpId=${udpId} received successfully — token=${matched.token.slice(0, 8)}…, key=${matched.key.slice(0, 8)}…`);
            } else {
                this.log.debug(`getToken[${deviceId}] (V1): ${m.name} udpId=${udpId} not in tokenlist (cloud returned ${list.length} entries) — falling through to next method`);
            }
        }
        this.log.debug(`getToken[${deviceId}] (V1): done — ${candidates.length} candidate(s) [${stats.join(", ")}]`);
        if (!candidates.length && errors.length === methods.length) {
            throw new Error(`CloudClientV1: getToken failed for deviceId=${deviceId} on all methods (${errors.join("; ")})`);
        }
        return candidates;
    }

    /**
     * Convenience wrapper returning the first candidate.
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<{token: string, key: string}>}
     */
    async getToken(deviceId) {
        const candidates = await this.getTokenCandidates(deviceId);
        if (!candidates.length) {
            throw new Error(`CloudClientV1: no token/key pair found for deviceId=${deviceId}`);
        }
        return { token: candidates[0].token, key: candidates[0].key };
    }

    async listAppliances() {
        await this.authenticate();
        this.log.debug("CloudClientV1: listAppliances()");
        const result = await this._apiRequest("/v1/appliance/user/list/get", {});
        const list = result.list || [];
        return list.map((it) => ({
            id: String(it.id),
            name: it.name,
            type: typeof it.type === "string" ? parseInt(it.type, 16) : Number(it.type),
            modelNumber: it.modelNumber,
            sn: it.sn,
            online: it.onlineStatus === "1" || it.onlineStatus === 1,
        }));
    }
}

/**
 * Pick the right cloud client based on the configured app variant.
 * `msmarthome` (default) → V3 stack (mp-prod.appsmb.com).
 * `nethome` / `midea-air` / `ariston-clima` → V1 stack (mapp.appsmb.com).
 */
function createCloudClient(opts) {
    const app = (opts && opts.app) || "msmarthome";
    if (app === "msmarthome") return new CloudClient(opts);
    return new CloudClientV1(Object.assign({}, opts, { appName: app }));
}

/**
 * NetHome Plus shared default credentials shipped by msmart-ng. The NetHome
 * `getToken` endpoint is account-agnostic — any valid login can fetch the
 * token+key for any online udpId. Used as a transparent fallback when the
 * user-configured cloud (most commonly MSmartHome) refuses to issue
 * LAN credentials (typical: code 3004 "value is illegal").
 */
const NETHOME_SHARED_USER = "nethome+us@mailinator.com";
const NETHOME_SHARED_PASSWORD = "password1";

/**
 * Module-cached fallback client: one login per adapter start, regardless of
 * how many devices hit the fallback path.
 * @type {CloudClientV1|null}
 */
let _sharedFallbackClient = null;
/** @type {object|null} */
let _sharedFallbackLogger = null;

function _getSharedFallback(logger) {
    if (!_sharedFallbackClient || _sharedFallbackLogger !== logger) {
        _sharedFallbackClient = new CloudClientV1({
            appName: "nethome",
            user: NETHOME_SHARED_USER,
            password: NETHOME_SHARED_PASSWORD,
            logger,
        });
        _sharedFallbackLogger = logger;
    }
    return _sharedFallbackClient;
}

/**
 * Try the user's configured cloud first; on failure (or empty result),
 * fall back to NetHome Plus with msmart-ng's shared mailinator credentials.
 * Throws only if both primary and fallback hard-fail; returns `[]` if both
 * paths simply produced no candidates.
 *
 * @param {CloudClient|CloudClientV1} primary
 * @param {string|number|bigint} deviceId
 * @param {object} [logger] same shape as makeLogger expects
 * @returns {Promise<Array<{method: string, token: string, key: string}>>}
 */
async function getTokenCandidatesWithFallback(primary, deviceId, logger) {
    const log = makeLogger(logger);
    try {
        const candidates = await primary.getTokenCandidates(deviceId);
        if (candidates && candidates.length) return candidates;
        log.info(
            `getToken[${deviceId}]: primary cloud returned no candidates — falling back to NetHome Plus shared credentials`,
        );
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        log.info(
            `getToken[${deviceId}]: primary cloud failed (${msg}) — falling back to NetHome Plus shared credentials`,
        );
    }

    const fallback = _getSharedFallback(logger);
    try {
        const candidates = await fallback.getTokenCandidates(deviceId);
        if (candidates && candidates.length) {
            log.info(
                `getToken[${deviceId}]: NetHome Plus fallback succeeded (${candidates.length} candidate(s))`,
            );
            return candidates;
        }
        log.warn(
            `getToken[${deviceId}]: NetHome Plus fallback returned no candidates either. ` +
                "If you have your own NetHome Plus / Midea Air / Ariston Clima account, configure it as the cloud app in the adapter settings.",
        );
        return [];
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        log.warn(
            `getToken[${deviceId}]: NetHome Plus fallback also failed (${msg}). ` +
                "If you have your own NetHome Plus / Midea Air / Ariston Clima account, configure it as the cloud app in the adapter settings.",
        );
        throw err;
    }
}

module.exports = {
    CloudClient,
    CloudClientV1,
    createCloudClient,
    getTokenCandidatesWithFallback,
    V1_APPS,
};
