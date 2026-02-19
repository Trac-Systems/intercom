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

function termWidth() {
  return Math.max(60, Number(process.stdout.columns) || 80);
}

function centerLine(line, width) {
  const w = width || termWidth();
  const raw = String(line ?? "");
  const pad = Math.max(0, Math.floor((w - raw.length) / 2));
  return " ".repeat(pad) + raw;
}

function centerBlock(text, width) {
  const w = width || termWidth();
  return String(text ?? "")
    .split("\n")
    .map((l) => centerLine(l, w))
    .join("\n");
}

function menuHeader() {
  const title = chalk.whiteBright("MAIN MENU");
  const subtitle = chalk.gray("Choose an action (Pro UI Mode)");
  const card = boxen(`${title}\n${subtitle}`, {
    padding: 1,
    borderStyle: "round",
    borderColor: "white"
  });
  return centerBlock(card, termWidth());
}

function menuFooterHint() {
  const hint = chalk.gray("Tip: Use arrow keys • Press Enter • Ctrl+C to exit");
  return centerLine(hint, termWidth());
}

async function runMenu() {
  while (true) {
    clear();

    console.log(centerLine(chalk.cyanBright("GAMBER CLI TOKEN ANALYZER")));
    console.log("");
    console.log(menuHeader());
    console.log("");

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
          { name: "4) ⚙️  Settings", value: "settings" },
          { name: "0) ❌ Exit", value: "exit" }
        ]
      }
    ]);

    if (pick === "exit") {
      clear();
      console.log(centerLine(chalk.cyanBright("👋 Bye. GAMBER out.")));
      process.exit(0);
    }

    try {
      if (pick === "price") await actionPriceMonitor();
      if (pick === "ca") await actionTokenCAAnalyze();
      if (pick === "agent") await actionAgentSignal();
      if (pick === "settings") await actionSettings();
    } catch (err) {
      const errBox = boxen(chalk.redBright(`Error: ${err?.message || err}`), {
        padding: 1,
        borderStyle: "round",
        borderColor: "redBright"
      });
      console.log("\n" + centerBlock(errBox, termWidth()) + "\n");
      await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to continue..." }]);
    }

    console.log("\n" + menuFooterHint() + "\n");
  }
}

module.exports = { runMenu };
