'use strict';

const Homey = require('homey');
const mqtt = require('mqtt');

const MQTT_URL = 'wss://cloud.ozonos.com:8443/mqtt';
const MQTT_USERNAME = 'ozonos';
const MQTT_PASSWORD = 'frischluft';

module.exports = class OzonosACIIDevice extends Homey.Device {

  async onInit() {
    this.log('OzonosACIIDevice initialized');

    const { uid } = this.getStore();
    this.uid = uid;
    this.topicInfo = `OZONOS/AC2/${uid}/INFO`;
    this.topicRemote = `OZONOS/AC2/${uid}/REMOTE`;

    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('ozonos_timer_setting', this.onCapabilityTimerSetting.bind(this));

    await this.refreshStatusFromRest();

    this.connectMqtt();
  }

  async refreshStatusFromRest() {
    const { username, password } = this.getStore();
    if (!username || !password) {
      this.error('No Ozonos credentials stored, skipping REST status refresh');
      return;
    }

    try {
      const loginRes = await fetch('https://cloud.ozonos.com/api/?c=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      });
      const loginJson = await loginRes.json();

      if (loginJson.status !== 200) {
        this.error('REST login failed during status refresh');
        return;
      }

      const authtoken = loginJson.data.authtoken;

      const devicesRes = await fetch('https://cloud.ozonos.com/api/?c=client_devices&a=get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Xsrf-Token': authtoken,
        },
        body: 'id=undefined',
      });
      const devicesJson = await devicesRes.json();

      if (devicesJson.status !== 200) {
        this.error('REST client_devices failed during status refresh');
        return;
      }

      const match = devicesJson.data.find((d) => d.uid === this.uid);
      if (match && match.deviceinfo) {
        this.applyStatus(match.deviceinfo);
      }
    } catch (err) {
      this.error('REST status refresh failed', err);
    }
  }

  connectMqtt() {
    const suffix = Math.random().toString(36).slice(2, 10);
    const clientId = `OZONOSREMOTE-${this.getData().id}_${suffix}`;

    this.client = mqtt.connect(MQTT_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clientId,
      keepalive: 120,
      clean: true,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      this.log('MQTT connected');
      this.setAvailable();
      this.client.subscribe(this.topicInfo, (err) => {
        if (err) this.error('MQTT subscribe failed', err);
      });
    });

    this.client.on('message', (topic, payload, packet) => {
      if (topic !== this.topicInfo) return;
      this.onInfoMessage(payload);
    });

    this.client.on('error', (err) => {
      this.error('MQTT error', err);
    });

    this.client.on('close', () => {
      this.setUnavailable('Verbinding met Ozonos cloud verbroken').catch(() => {});
    });
  }

  onInfoMessage(payload) {
    let data;
    try {
      data = JSON.parse(payload.toString());
      //this.log('INFO message received:', JSON.stringify(data));
    } catch (err) {
      this.error('Failed to parse INFO payload', err);
      return;
    }

    this.applyStatus(data);
  }

  applyStatus(data) {
    this.setCapabilityValue('onoff', data.pwr === 1).catch(this.error);
    this.setCapabilityValue('measure_ozonos_timer', data.timer).catch(this.error);
    this.setCapabilityValue('meter_ozonos_hours', data.hours).catch(this.error);
    this.setCapabilityValue('meter_ozonos_lamp_starts', data.lampStartings).catch(this.error);

    this.setSettings({
      fullSerialnr: data.fullSerialnr,
      firmwareEsp32: data.esp32,
      firmwareHost: data.host,
    }).catch(this.error);
  }

  async onCapabilityOnoff(value) {
    const timer = Number(this.getCapabilityValue('ozonos_timer_setting')) || 0;
    this.client.publish(this.topicRemote, JSON.stringify({
      pwr: value ? 1 : 0,
      timer,
    }));
  }

  async onCapabilityTimerSetting(value) {
    // Alleen de gekozen waarde opslaan, geen MQTT-bericht sturen.
    // De waarde wordt pas gebruikt bij het inschakelen (zie onCapabilityOnoff) of via de "turn on for X minutes" flow-actie.
  }

  async turnOnForMinutes(minutes) {
    this.client.publish(this.topicRemote, JSON.stringify({
      pwr: 1,
      timer: minutes,
    }));
  }

  async onUninit() {
    if (this.client) {
      this.client.end(true);
    }
  }

};