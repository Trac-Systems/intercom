"use strict";

const chalk = require("chalk");
const figlet = require("figlet");
const boxen = require("boxen");

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

function hr() {
  return chalk.gray("─".repeat(termWidth()));
}

function buildTitleBlock() {
  const w = termWidth();

  const gamber = figlet.textSync("GAMBER", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default"
  });

  const sub = figlet.textSync("CLI TOKEN ANALYZER", {
    font: "Small",
    horizontalLayout: "default",
    verticalLayout: "default"
  });

  const centered = centerBlock(chalk.cyanBright(gamber) + "\n" + chalk.whiteBright(sub), w);

  // Put the centered ASCII inside a box that is also visually centered
  // We keep a fixed-ish inner width so it looks consistent across terminals.
  const innerWidth = Math.min(76, w - 8);
  const boxed = boxen(centerBlock(chalk.cyanBright(gamber) + "\n" + chalk.whiteBright(sub), innerWidth), {
    padding: 1,
    borderStyle: "round",
    borderColor: "cyanBright"
  });

  // Now center the whole box as a block
  return centerBlock(boxed, w);
}

async function showBootScreen() {
  clear();

  console.log(buildTitleBlock());
  console.log(centerLine(chalk.gray("Price Monitor • CA Analyzer (DexScreener) • Agent Signal (EMA/RSI)")));
  console.log(hr());

  const w = termWidth();
  const hotkeys = boxen(
    [
      chalk.whiteBright("Hotkeys"),
      chalk.gray("• Ctrl + C : Exit"),
      chalk.gray("• Enter   : Select"),
      chalk.gray("• ↑ / ↓   : Navigate")
    ].join("\n"),
    { padding: 1, borderStyle: "round", borderColor: "gray" }
  );

  console.log(centerBlock(hotkeys, w));
  console.log("");
}

module.exports = { showBootScreen };
