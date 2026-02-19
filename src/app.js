"use strict";

const { showBootScreen } = require("./ui/brand");
const { runMenu } = require("./ui/menu");

async function runApp() {
  await showBootScreen();
  await runMenu();
}

module.exports = { runApp };
