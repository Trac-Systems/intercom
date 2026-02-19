"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");

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

async function runMenu() {
  while (true) {
    clear();

    // keep it minimal & clean
    console.log(centerLine(chalk.cyanBright("GAMBER CLI TOKEN ANALYZER")));
    console.log("");

    const { pick } = await inquirer.prompt([
      {
        type: "list",
        name: "pick",
        message: "Select:",
        pageSize: 10,
        choices: [
          { name: "📡 Live Price Monitor (CoinGecko)", value: "price" },
          { name: "🔎 Token CA Analyzer (DexScreener)", value: "ca" },
          { name: "🧠 Agent Signal (EMA/RSI)", value: "agent" },
          { name: "⚙️  Settings", value: "settings" },
          { name: "❌ Exit", value: "exit" }
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
      clear();
      console.log(chalk.redBright(`\nError: ${err?.message || err}\n`));
      await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to continue..." }]);
    }
  }
}

module.exports = { runMenu };
