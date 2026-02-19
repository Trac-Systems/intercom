"use strict";

const chalk = require("chalk");
const figlet = require("figlet");
const boxen = require("boxen");

function clear() {
  process.stdout.write("\x1Bc");
}

function hr() {
  return chalk.gray("─".repeat(Math.max(40, process.stdout.columns || 80)));
}

function bigTitle() {
  const text = figlet.textSync("GAMBER", { font: "ANSI Shadow", horizontalLayout: "default" });
  const sub = figlet.textSync("CLI TOKEN ANALYZER", { font: "Small" });

  const title = chalk.cyanBright(text) + "\n" + chalk.whiteBright(sub);

  const boxed = boxen(title, {
    padding: 1,
    margin: 0,
    borderStyle: "round",
    borderColor: "cyanBright"
  });

  return boxed;
}

async function showBootScreen() {
  clear();
  console.log(bigTitle());
  console.log(chalk.gray("Price Monitor • CA Analyzer (DexScreener) • Agent Signal (EMA/RSI)"));
  console.log(hr());
  console.log(
    boxen(
      [
        chalk.whiteBright("Hotkeys"),
        chalk.gray("• Ctrl + C : Exit"),
        chalk.gray("• Enter   : Select"),
        chalk.gray("• ↑ / ↓   : Navigate")
      ].join("\n"),
      { padding: 1, borderStyle: "round", borderColor: "gray" }
    )
  );
}

module.exports = { showBootScreen };
