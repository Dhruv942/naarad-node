class WatiConfig {
  /**
   * ACCESS_TOKEN: WATI access token (required)
   * BASE_URL: Base URL for WATI instance
   * TEMPLATE_NAME: Default template name for news alerts
   * BROADCAST_NAME: Default broadcast name for news alerts
   * CHANNEL_NUMBER: Optional channel number
   * WELCOME_TEMPLATE: Template name for welcome messages
   * WELCOME_BROADCAST: Broadcast name for welcome messages
   */
  static get ACCESS_TOKEN() {
    return process.env.WATI_ACCESS_TOKEN || "";
  }

  static get BASE_URL() {
    return process.env.WATI_BASE_URL || "https://live-mt-server.wati.io/458913";
  }

  static get TEMPLATE_NAME() {
    return process.env.WATI_TEMPLATE_NAME || "new_updated";
  }

  static get BROADCAST_NAME() {
    return process.env.WATI_BROADCAST_NAME || "new_updated_221220250942";
  }

  static get CHANNEL_NUMBER() {
    return process.env.WATI_CHANNEL_NUMBER || "";
  }

  static get WELCOME_TEMPLATE() {
    return process.env.WATI_WELCOME_TEMPLATE || "welcome";
  }

  static get WELCOME_BROADCAST() {
    return process.env.WATI_WELCOME_BROADCAST || "welcome_051020251845";
  }
}

module.exports = WatiConfig;
