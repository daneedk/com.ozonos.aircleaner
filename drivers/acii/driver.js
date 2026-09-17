'use strict';

const Homey = require('homey');

module.exports = class OzonosACIIDriver extends Homey.Driver {

  async onInit() {
    this.log('OzonosACIIDriver initialized');

    this.homey.flow.getActionCard('turn_on_for_minutes')
      .registerRunListener(async (args) => {
        await args.device.turnOnForMinutes(Number(args.minutes));
      });
  }

  async onPair(session) {
    let authtoken = null;
    let ozonosUsername = null;
    let ozonosPassword = null;

    session.setHandler('login', async ({ username, password }) => {
      const res = await fetch('https://cloud.ozonos.com/api/?c=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      });
      const text = await res.text();
      //this.log('login response status:', res.status, 'body:', text);
      //this.log('login response headers:', JSON.stringify([...res.headers.entries()]));

      const json = JSON.parse(text);

      if (json.status !== 200) {
        throw new Error('Login mislukt, controleer e-mailadres en wachtwoord');
      }

      authtoken = json.data.authtoken;
      ozonosUsername = username;
      ozonosPassword = password;
      return true;
    });

    session.setHandler('list_devices', async () => {
      const res = await fetch('https://cloud.ozonos.com/api/?c=client_devices&a=get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Xsrf-Token': authtoken,
        },
        body: 'id=undefined',
      });
      const text = await res.text();
      //this.log('list_devices response status:', res.status, 'body:', text);
      //this.log('list_devices response headers:', JSON.stringify([...res.headers.entries()]));

      const json = JSON.parse(text);

      if (json.status !== 200) {
        throw new Error('Kon apparaatlijst niet ophalen');
      }

      return json.data.map((device) => ({
        name: `Ozonos ACII (${device.uid.slice(-6)})`,
        data: { id: String(device.id) },
        store: { uid: device.uid, username: ozonosUsername, password: ozonosPassword },
      }));
    });
  }

};