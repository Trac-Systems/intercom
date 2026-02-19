"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");
const boxen = require("boxen");

const { config } = require("../config");

async function actionSettings() {
  process.stdout.write("\x1Bc");
  console.log(
    boxen(chalk.whiteBright("⚙️ SETTINGS (read-only from .env)"), { padding: 1, borderStyle: "round", borderColor: "white" })
  );

  const lines = [
    `COINGECKO_VS = ${config.COINGECKO_VS}`,
    `POLL_MS      = ${config.POLL_MS}`,
    `RSI_PERIOD   = ${config.RSI_PERIOD}`,
    `EMA_FAST     = ${config.EMA_FAST}`,
    `EMA_SLOW     = ${config.EMA_SLOW}`
  ].join("\n");

  console.log(boxen(lines, { padding: 1, borderStyle: "round", borderColor: "gray" }));
  console.log(chalk.gray("\nEdit .env to change values.\n"));

  await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to return..." }]);
}

module.exports = { actionSettings };
