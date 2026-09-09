const { createApp } = require("./app");

const app = createApp();

if (require.main === module) {
  app.listen(process.env.PORT || 3000, "0.0.0.0");
}

module.exports = app;
module.exports.createApp = createApp;
