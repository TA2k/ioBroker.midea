"use strict";

/*
 * Created with @iobroker/create-adapter v1.21.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const request = require("request");
const traverse = require("traverse");
const crypto = require("crypto");
class Midea extends utils.Adapter {
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "midea"
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.jar = request.jar();
        this.updateInterval = null;
        this.reauthInterval = null;
        this.atoken;
        this.sId;
        this.hgIdArray = [];
        this.appKey = "ff0cf6f5f0c3471de36341cab3f7a9af";
        this.baseHeader = {
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 7.0; SM-G935F Build/NRD90M)"
        };
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.login().then(() => {
            this.log.debug("Login successful");
            this.setState("info.connection", true, true);
            this.getUserList().then(()=>{});
            
        });

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");
    }
    login() {
        return new Promise((resolve, reject) => {
            this.jar = request.jar();
            const form = {
                loginAccount: this.config.user,
                clientType: "1",
                src: "17",
                appId: "1117",
                format: "2",
                stamp: this.getStamp(),
                language: "de_DE"
            };
            const url = "https://mapp.appsmb.com/v1/user/login/id/get";
            const sign = this.getSign(url, form);
            form.sign = sign;
            request.post(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true,
                    json: true,
                    form: form,
                    jar: this.jar,
                    gzip: true
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400) || !body) {
                        this.log.error("Failed to login");
                        err && this.log.error(err);
                        body && this.log.error(JSON.stringify(body));
                        resp && this.log.error(resp.statusCode);
                        reject();
                        return;
                    }
                    this.log.debug(JSON.stringify(body));
                    if (body.errorCode && body.errorCode !== "0") {
                        this.log.error(body.msg);
                        reject();
                        return;
                    }
                    if (body.result) {
                        const loginId = body.result.loginId;
                        const password = this.getSignPassword(loginId);
                        const form = {
                            loginAccount: this.config.user,
                            src: "17",
                            format: "2",
                            stamp: this.getStamp(),
                            language: "de_DE",
                            password: password,
                            clientType: "1",
                            appId: "1117"
                        };
                        const url = "https://mapp.appsmb.com/v1/user/login";
                        const sign = this.getSign(url, form);
                        form.sign = sign;
                        request.post(
                            {
                                url: url,
                                headers: this.baseHeader,
                                followAllRedirects: true,
                                json: true,
                                form: form,
                                jar: this.jar,
                                gzip: true
                            },
                            (err, resp, body) => {
                                if (err || (resp && resp.statusCode >= 400) || !body) {
                                    this.log.error("Failed to login");
                                    err && this.log.error(err);
                                    body && this.log.error(JSON.stringify(body));
                                    resp && this.log.error(resp.statusCode);
                                    reject();
                                    return;
                                }
                                this.log.debug(JSON.stringify(body));
                                if (body.errorCode && body.errorCode !== "0") {
                                    this.log.error(body.msg);
                                    reject();
                                    return;
                                }
                                if (body.result) {
                                    this.atoken = body.result.accessToken;
                                    this.sId = body.result.sessionId;
                                    resolve();
                                }
                            }
                        );
                    }
                }
            );
        });
    }
    getUserList() {
        return new Promise((resolve, reject) => {
            const form = {
                src: "17",
                format: "2",
                stamp: this.getStamp(),
                language: "de_DE",
                sessionId: this.sId
            };
            const url = "https://mapp.appsmb.com/v1/appliance/user/list/get";
            const sign = this.getSign(url, form);
            form.sign = sign;
            request.post(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true,
                    json: true,
                    form: form,
                    jar: this.jar,
                    gzip: true
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400) || !body) {
                        this.log.error("Failed to login");
                        err && this.log.error(err);
                        body && this.log.error(JSON.stringify(body));
                        resp && this.log.error(resp.statusCode);
                        reject();
                        return;
                    }
                    this.log.debug(JSON.stringify(body));
                    if (body.errorCode && body.errorCode !== "0") {
                        this.log.error(body.msg);
                        reject();
                        return;
                    }
                    try {
                        if (body.result && body.result.list && body.result.list.length > 0) {
                            body.result.list.forEach(currentElement => {
                                this.hgIdArray.push(currentElement.id);

                                this.setObjectNotExists(currentElement.id, {
                                    type: "device",
                                    common: {
                                        name: currentElement.name,
                                        role: "indicator",
                                        write: false,
                                        read: true
                                    },
                                    native: {}
                                });
                                Object.keys(currentElement).forEach(key => {
                                    this.setObjectNotExists(currentElement.id + ".general." + key, {
                                        type: "state",
                                        common: {
                                            name: key,
                                            role: "indicator",
                                            type: typeof currentElement[key],
                                            write: false,
                                            read: true
                                        },
                                        native: {}
                                    });
                                    this.setState(currentElement.id + ".general." + key, currentElement[key], true);
                                });
                            });
                        }
                        resolve();
                    } catch (error) {
                        this.log.error(error);
                        this.log.error(error.stack);
                        reject();
                    }
                }
            );
        });
    }
    getSign(path, form) {
        const postfix =
            "/" +
            path
                .split("/")
                .slice(3)
                .join("/");
        const ordered = {};
        Object.keys(form)
            .sort()
            .forEach(function(key) {
                ordered[key] = form[key];
            });
        const query = Object.keys(ordered)
            .map(key => key + "=" + ordered[key])
            .join("&");

        return crypto
            .createHash("sha256")
            .update(postfix + query + this.appKey)
            .digest("hex");
    }
    getSignPassword(loginId) {
        const pw = crypto
            .createHash("sha256")
            .update(this.config.password)
            .digest("hex");

        return crypto
            .createHash("sha256")
            .update(loginId + pw + this.appKey)
            .digest("hex");
    }
    getStamp() {
        const date = new Date();
        return date
            .toISOString()
            .slice(0, 19)
            .replace(/-/g, "")
            .replace(/:/g, "")
            .replace(/T/g, "");
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            clearInterval(this.updateInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = options => new Midea(options);
} else {
    // otherwise start the instance directly
    new Midea();
}
