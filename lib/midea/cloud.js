"use strict";

const crypto = require("crypto");
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
     * Fetch the per-device key/token pair. The udpId is derived from the
     * device's id with deriveUdpId().
     */
    async getToken(udpId) {
        await this.authenticate();
        this.log.debug(`CloudClient: getToken(udpId=${udpId})`);
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
        this.log.debug(`CloudClient: getToken got ${list.length} entries`);
        for (const pair of list) {
            if (pair.udpId === udpId) {
                return { token: pair.token, key: pair.key };
            }
        }
        throw new Error(`CloudClient: no token/key pair found for udpId=${udpId}`);
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

module.exports = { CloudClient };
