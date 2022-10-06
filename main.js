"use strict";

/*
 * Created with @iobroker/create-adapter v1.21.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const { py, python } = require("pythonia");
const Json2iob = require("./lib/json2iob");

class Midea extends utils.Adapter {
  /**
   * @param {Partial<ioBroker.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: "midea",
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.json2iob = new Json2iob(this);
    this.devices = {};
    //redirect log to adapter
    console.log = (args) => {
      this.log.info(args);
    };
    this.appCredentials = {
      nethome: {
        appkey: "3742e9e5842d4ad59c2db887e12449f9",
        appid: 1017,
        api_url: "https://mapp.appsmb.com",
        sign_key: "xhdiwjnchekd4d512chdjx5d8e4c394D2D7S",
        proxied: null,
      },
      midea: {
        appkey: "ff0cf6f5f0c3471de36341cab3f7a9af",
        appid: 1117,
        api_url: "https://mapp.appsmb.com",
        sign_key: "xhdiwjnchekd4d512chdjx5d8e4c394D2D7S",
        proxied: null,
      },
      msmarthome: {
        appkey: "ac21b9f9cbfe4ca5a88562ef25e2b768",
        appid: 1010,
        api_url: "https://mp-prod.appsmb.com/mas/v5/app/proxy?alias=",
        sign_key: "xhdiwjnchekd4d512chdjx5d8e4c394D2D7S",
        iotkey: "meicloud",
        hmackey: "PROD_VnoClJI9aikS8dyy",
        proxied: "v5",
      },
    };
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.setState("info.connection", false, true);
    if (this.config.interval < 0.5) {
      this.log.info("Set interval to minimum 0.5");
      this.config.interval = 0.5;
    }
    if (!this.config.user || !this.config.password) {
      this.log.error("Please set username and password in the instance settings");
      return;
    }

    this.midea_beautiful = await python("midea_beautiful");
    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);
    this.cloud = await this.login();
    await this.getDeviceList();
    await this.updateDevices();
    this.updateInterval = setInterval(() => {
      this.updateDevices();
    }, this.config.interval * 60 * 1000);

    // in this template all states changes inside the adapters namespace are subscribed
    this.subscribeStates("*");
  }
  async login() {
    try {
      const cloud = await this.midea_beautiful.connect_to_cloud$({
        account: this.config.user,
        password: this.config.password,
        ...this.appCredentials[this.config.type],
      });
      this.log.debug(await cloud.__dict__);
      this.log.info("Login successful");
      this.setState("info.connection", true, true);
      return cloud;
    } catch (error) {
      this.log.error(error);
      error.stack && this.log.error(error.stack);
    }
  }
  async getDeviceList() {
    try {
      this.log.info("Getting devices");
      this.appliances = await this.midea_beautiful.find_appliances$({
        cloud: this.cloud,
      });
      this.log.info(`Found ${await this.appliances.length} devices`);
      console.log(this.appliances);
      console.log(this.appliances[0]);
      for await (const [index, app] of await py.enumerate(this.appliances)) {
        this.log.debug(await app);
        const appJsonString = this.pythonToJson(await app.state.__dict__.__str__());
        const appJson = JSON.parse(appJsonString);
        const id = appJson.id;
        this.devices[id] = appJson;
        await this.setObjectNotExistsAsync(id, {
          type: "device",
          common: {
            name: appJson.name,
          },
          native: {},
        });
        this.json2iob.parse(id, appJson, { write: true, forceIndex: true });
      }
    } catch (error) {
      this.log.error(error);
      error.stack && this.log.error(error.stack);
    }
  }
  async updateDevices() {
    try {
      for (const id in this.devices) {
        let appliance_state;
        if (this.config.local) {
          if (this.devices[id].address) {
            appliance_state = await this.midea_beautiful.appliance_state$({
              address: this.devices[id].address,
              token: this.devices[id].token,
              key: this.devices[id].key,
              appliance_id: id,
            });
          } else {
            this.log.info("Missing ip for " + id + " device update via cloud");
            appliance_state = await this.midea_beautiful.appliance_state$({
              cloud: this.cloud,
              appliance_id: id,
              use_cloud: true,
            });
          }
        } else {
          appliance_state = await this.midea_beautiful.appliance_state$({
            cloud: this.cloud,
            appliance_id: id,
            use_cloud: true,
          });
        }
        this.log.debug(await appliance_state);
        const stateString = this.pythonToJson(await appliance_state.state.__dict__.__str__());
        const stateJson = JSON.parse(stateString);
        this.json2iob.parse(id, stateJson, { write: true, forceIndex: true });
      }
    } catch (error) {
      this.log.error(error);
      error.stack && this.log.error(error.stack);
    }
  }

  pythonToJson(objectString) {
    if (!objectString.replace) {
      this.log.warn("pythonToJson: objectString is not a string");
      return objectString;
    }
    objectString = objectString
      .replace(/b'[^']*'/g, "''")
      .replace(/: <[^<]*>,/g, ":'',")
      .replace(/{'_/g, `{'`)
      .replace(/, '_/g, `, '`)
      .replace(/'/g, `"`)
      .replace(/ None,/g, `null,`)
      .replace(/ True,/g, `true,`)
      .replace(/ False,/g, `false,`);

    this.log.debug(objectString);
    return objectString;
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      python.exit();
      this.updateInterval && clearInterval(this.updateInterval);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
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
  async onStateChange(id, state) {
    if (state && !state.ack) {
      const deviceId = id.split(".")[2];
      const command = id.split(".").pop;
      const index = Object.keys(this.devices).indexOf(deviceId);
      const appliance = await this.appliances[index];
      const setState = { cloud: this.cloud };
      setState[command] = state.val;
      this.log.debug(JSON.stringify(setState));
      try {
        await appliance.set_state$(setState);
      } catch (error) {
        this.log.error(error);
        error.stack && this.log.error(error.stack);
      }
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = setTimeout(async () => {
        await this.updateDevices();
      }, 10 * 1000);
    }
  }
}
if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Midea(options);
} else {
  // otherwise start the instance directly
  new Midea();
}
