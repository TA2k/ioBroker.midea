"use strict";

const crypto = require("node:crypto");
const axios = require("axios");

const sec = require("./security");
const { makeLogger } = require("./logger");

const DEFAULT_HOST = "mp-prod.appsmb.com";

function strftime() {
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return (
        now.getFullYear() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds())
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
        this.deviceId = opts.deviceId || crypto.randomBytes(8).toString("hex");
        this.log = makeLogger(opts.logger);

        this._loginId = null;
        this._accessToken = "";
        this._authPromise = null;
    }

    async _apiRequest(path, payload) {
        const body = JSON.stringify(payload);
        const random = Math.floor(Date.now() / 1000).toString();
        const signature = sec.signCloudPayload(body, random);

        const url = `https://${this.host}/mas/v5/app/proxy?alias=${path}`;
        const headers = {
            sign: signature,
            secretVersion: "1",
            random,
            "Content-Type": "application/json",
            accessToken: this._accessToken || "",
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
                this.log.debug("CloudClient: authenticated");
                return this._accessToken;
            } finally {
                this._authPromise = null;
            }
        })();
        return this._authPromise;
    }

    /**
     * Fetch the per-device key/token pair. Pass the raw device id (decimal
     * string or number); the cloud accepts either BIG (6-byte BE) or LITTLE
     * (6-byte LE) udpId, and which one is registered varies per device — so
     * we try BIG first, then LITTLE, mirroring midea-local.
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<{token: string, key: string}>}
     */
    async getToken(deviceId) {
        await this.authenticate();
        const methods = [
            { name: "BIG", id: sec.UDP_ID_METHODS.BIG },
            { name: "LITTLE", id: sec.UDP_ID_METHODS.LITTLE },
        ];
        const errors = [];
        for (const m of methods) {
            const udpId = sec.deriveUdpId(deviceId, m.id);
            this.log.debug(`CloudClient: getToken(deviceId=${deviceId}, method=${m.name}, udpId=${udpId})`);
            const data = await this._apiRequest("/v1/iot/secure/getToken", {
                appId: "1010",
                format: 2,
                clientType: 1,
                language: "en_US",
                src: "1010",
                stamp: strftime(),
                reqId: crypto.randomBytes(16).toString("hex"),
                udpid: udpId,
            });
            const list = (data.data && data.data.tokenlist) || [];
            this.log.debug(`CloudClient: getToken[${m.name}] got ${list.length} entries`);
            for (const pair of list) {
                if (pair.udpId === udpId) {
                    this.log.debug(`CloudClient: getToken matched method=${m.name}`);
                    return { token: pair.token, key: pair.key };
                }
            }
            errors.push(`${m.name}=${list.length} entries, none matched`);
        }
        throw new Error(`CloudClient: no token/key pair found for deviceId=${deviceId} (${errors.join("; ")})`);
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
     * Fetch the per-device key/token pair. Pass the raw device id; we try
     * BIG (6-byte BE) and LITTLE (6-byte LE) udpId methods like midea-local.
     *
     * @param {string|number|bigint} deviceId
     * @returns {Promise<{token: string, key: string}>}
     */
    async getToken(deviceId) {
        await this.authenticate();
        const methods = [
            { name: "BIG", id: sec.UDP_ID_METHODS.BIG },
            { name: "LITTLE", id: sec.UDP_ID_METHODS.LITTLE },
        ];
        const errors = [];
        for (const m of methods) {
            const udpId = sec.deriveUdpId(deviceId, m.id);
            this.log.debug(`CloudClientV1: getToken(deviceId=${deviceId}, method=${m.name}, udpId=${udpId})`);
            const result = await this._apiRequest("/v1/iot/secure/getToken", { udpid: udpId });
            const list = result.tokenlist || [];
            this.log.debug(`CloudClientV1: getToken[${m.name}] got ${list.length} entries`);
            for (const pair of list) {
                if (pair.udpId === udpId) {
                    this.log.debug(`CloudClientV1: getToken matched method=${m.name}`);
                    return { token: pair.token, key: pair.key };
                }
            }
            errors.push(`${m.name}=${list.length} entries, none matched`);
        }
        throw new Error(`CloudClientV1: no token/key pair found for deviceId=${deviceId} (${errors.join("; ")})`);
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

module.exports = { CloudClient, CloudClientV1, createCloudClient, V1_APPS };
