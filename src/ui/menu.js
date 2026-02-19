"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");
const boxen = require("boxen");

const { actionPriceMonitor } = require("../workflows/priceMonitor");
const { actionTokenCAAnalyze } = require("../workflows/tokenCAAnalyze");
const { actionAgentSignal } = require("../workflows/agentSignal");
const { actionSettings } = require("../workflows/settings");

function clear() {
  process.stdout.write("\x1Bc");
}

function menuHeader() {
  const title = chalk.whiteBright("MAIN MENU");
  const subtitle = chalk.gray("Choose an action (Pro UI Mode)");
  return boxen(`${title}\n${subtitle}`, {
    padding: 1,
    borderStyle: "round",
    borderColor: "white"
  });
}

async function runMenu() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    clear();
    console.log(chalk.cyanBright("GAMBER CLI TOKEN ANALYZER"));
    console.log(menuHeader());

    const { pick } = await inquirer.prompt([
      {
        type: "list",
        name: "pick",
        message: "Select:",
        pageSize: 10,
        choices: [
          { name: "1) 📡 Live Price Monitor (CoinGecko)", value: "price" },
          { name: "2) 🔎 Token CA Analyzer (DexScreener)", value: "ca" },
          { name: "3) 🧠 Agent Signal (EMA/RSI)", value: "agent" },
          new inquirer.Separator(),
          { name: "4) ⚙️  Settings", value: "settings" },
          { name: "0) ❌ Exit", value: "exit" }
        ]
      }
    ]);

    if (pick === "exit") {
      clear();
      console.log(chalk.cyanBright("👋 Bye. GAMBER out."));
      process.exit(0);
    }

    try {
      if (pick === "price") await actionPriceMonitor();
      if (pick === "ca") await actionTokenCAAnalyze();
      if (pick === "agent") await actionAgentSignal();
      if (pick === "settings") await actionSettings();
    } catch (err) {
      console.log(
        boxen(chalk.redBright(`Error: ${err?.message || err}`), {
          padding: 1,
          borderStyle: "round",
          borderColor: "redBright"
        })
      );
      await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to continue..." }]);
    }
  }
}

module.exports = { runMenu };
