"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");
const boxen = require("boxen");
const Table = require("cli-table3");

const { config } = require("../config");
const { fetchCoinGeckoSimplePrice, fetchCoinGeckoOHLC } = require("../services/coingecko");
const { sleep } = require("../utils/sleep");
const { fmtNum, fmtUsd, nowTime } = require("../utils/format");

async function actionPriceMonitor() {
  const { coinId, vs, loops } = await inquirer.prompt([
    {
      type: "input",
      name: "coinId",
      message: "CoinGecko coin id (example: solana, bitcoin, ethereum):",
      default: "solana"
    },
    {
      type: "input",
      name: "vs",
      message: "VS currency (usd, idr, eur...):",
      default: config.COINGECKO_VS
    },
    {
      type: "input",
      name: "loops",
      message: "How many refresh cycles? (0 = infinite)",
      default: "0"
    }
  ]);

  const maxLoops = Number(loops);
  const isInfinite = !Number.isFinite(maxLoops) || maxLoops === 0;

  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    i += 1;

    const p = await fetchCoinGeckoSimplePrice(coinId.trim(), vs.trim());
    const ohlc = await fetchCoinGeckoOHLC(coinId.trim(), vs.trim(), "1");

    const last = p?.[coinId]?.[vs];
    const change24 = p?.[coinId]?.[`${vs}_24h_change`];
    const high24 = p?.[coinId]?.[`${vs}_24h_high`];
    const low24 = p?.[coinId]?.[`${vs}_24h_low`];
    const vol24 = p?.[coinId]?.[`${vs}_24h_vol`];

    const t = new Table({
      head: [chalk.whiteBright("Metric"), chalk.whiteBright("Value")],
      colWidths: [22, 40]
    });

    t.push(
      ["Time", chalk.gray(nowTime())],
      ["Price", chalk.cyanBright(fmtUsd(last))],
      ["24h Change", (change24 >= 0 ? chalk.greenBright : chalk.redBright)(`${fmtNum(change24)}%`)],
      ["24h High", fmtUsd(high24)],
      ["24h Low", fmtUsd(low24)],
      ["24h Volume", fmtNum(vol24)]
    );

    const mini = renderMiniOHLC(ohlc);

    process.stdout.write("\x1Bc");
    console.log(
      boxen(chalk.cyanBright("📡 LIVE PRICE MONITOR"), { padding: 1, borderStyle: "round", borderColor: "cyanBright" })
    );
    console.log(chalk.gray(`Coin: ${coinId}  •  VS: ${vs}  •  Poll: ${config.POLL_MS}ms\n`));
    console.log(t.toString());
    console.log("\n" + mini + "\n");
    console.log(chalk.gray("Tip: Ctrl+C to stop\n"));

    if (!isInfinite && i >= maxLoops) break;
    await sleep(config.POLL_MS);
  }

  await inquirer.prompt([{ type: "input", name: "x", message: "Done. Press Enter to return to menu..." }]);
}

function renderMiniOHLC(ohlc) {
  // OHLC array format: [timestamp, open, high, low, close]
  if (!Array.isArray(ohlc) || ohlc.length < 5) return chalk.gray("(No OHLC data)");

  const closes = ohlc.slice(-60).map((x) => Number(x?.[4])).filter((n) => Number.isFinite(n));
  if (closes.length < 10) return chalk.gray("(Not enough OHLC)");

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = Math.max(1e-9, max - min);

  const width = Math.min(72, Math.max(40, process.stdout.columns ? process.stdout.columns - 10 : 64));
  const levels = "▁▂▃▄▅▆▇█";

  const scaled = closes.slice(-width).map((v) => {
    const p = (v - min) / span;
    const idx = Math.max(0, Math.min(levels.length - 1, Math.floor(p * (levels.length - 1))));
    return levels[idx];
  });

  const line = scaled.join("");
  const header = chalk.whiteBright("Mini Chart (close, 1d): ");
  const range = chalk.gray(`min ${fmtUsd(min)} • max ${fmtUsd(max)}`);
  return header + chalk.cyanBright(line) + "\n" + range;
}

module.exports = { actionPriceMonitor };
