'use strict';

const Homey = require('homey');

module.exports = class Ozonos extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Ozonos has been initialized');
  }

};
