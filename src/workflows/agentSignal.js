"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");
const boxen = require("boxen");
const Table = require("cli-table3");

const { config } = require("../config");
const { fetchCoinGeckoMarketChart } = require("../services/coingecko");
const { ema, rsi } = require("../utils/indicators");
const { fmtUsd, fmtNum } = require("../utils/format");

async function actionAgentSignal() {
  const { coinId, vs, days } = await inquirer.prompt([
    {
      type: "input",
      name: "coinId",
      message: "CoinGecko coin id for signal (example: solana, bitcoin):",
      default: "solana"
    },
    {
      type: "input",
      name: "vs",
      message: "VS currency:",
      default: config.COINGECKO_VS
    },
    {
      type: "list",
      name: "days",
      message: "Chart window:",
      choices: [
        { name: "1 day (fast)", value: "1" },
        { name: "7 days", value: "7" },
        { name: "30 days", value: "30" }
      ],
      default: "1"
    }
  ]);

  process.stdout.write("\x1Bc");
  console.log(
    boxen(chalk.blueBright("🧠 AGENT SIGNAL (EMA/RSI)"), { padding: 1, borderStyle: "round", borderColor: "blueBright" })
  );

  const chart = await fetchCoinGeckoMarketChart(coinId.trim(), vs.trim(), days);
  const prices = (chart?.prices || []).map((x) => Number(x?.[1])).filter((n) => Number.isFinite(n));

  if (prices.length < 60) {
    console.log(boxen(chalk.yellowBright("Not enough price points for indicators."), { padding: 1, borderStyle: "round" }));
    await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to return..." }]);
    return;
  }

  const last = prices[prices.length - 1];
  const emaFast = ema(prices, config.EMA_FAST);
  const emaSlow = ema(prices, config.EMA_SLOW);
  const r = rsi(prices, config.RSI_PERIOD);

  const lastEmaFast = emaFast[emaFast.length - 1];
  const lastEmaSlow = emaSlow[emaSlow.length - 1];
  const lastRsi = r[r.length - 1];

  const signal = makeSignal(last, lastEmaFast, lastEmaSlow, lastRsi);

  const t = new Table({ colWidths: [20, 36] });
  t.push(
    [chalk.whiteBright("Price"), chalk.cyanBright(fmtUsd(last))],
    [chalk.whiteBright(`EMA(${config.EMA_FAST})`), fmtUsd(lastEmaFast)],
    [chalk.whiteBright(`EMA(${config.EMA_SLOW})`), fmtUsd(lastEmaSlow)],
    [chalk.whiteBright(`RSI(${config.RSI_PERIOD})`), fmtNum(lastRsi)]
  );

  console.log(chalk.gray(`Coin: ${coinId} • VS: ${vs} • Window: ${days}d\n`));
  console.log(t.toString() + "\n");

  console.log(
    boxen(signal.banner, {
      padding: 1,
      borderStyle: "round",
      borderColor: signal.color
    })
  );

  console.log(chalk.gray("\nRules: EMA cross + RSI zone (simple heuristic). Not financial advice.\n"));
  await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to return to menu..." }]);
}

function makeSignal(price, emaFast, emaSlow, rsiVal) {
  const trendUp = emaFast > emaSlow;
  const trendDown = emaFast < emaSlow;

  // Simple zones
  const oversold = rsiVal <= 30;
  const overbought = rsiVal >= 70;

  if (trendUp && oversold) {
    return { banner: `SIGNAL: BUY (Trend up + Oversold)\nConfidence: Medium`, color: "greenBright" };
  }
  if (trendDown && overbought) {
    return { banner: `SIGNAL: SELL (Trend down + Overbought)\nConfidence: Medium`, color: "redBright" };
  }
  if (trendUp && !overbought) {
    return { banner: `SIGNAL: HOLD / WAIT (Bullish bias)\nConfidence: Low`, color: "cyanBright" };
  }
  if (trendDown && !oversold) {
    return { banner: `SIGNAL: HOLD / WAIT (Bearish bias)\nConfidence: Low`, color: "yellowBright" };
  }
  return { banner: `SIGNAL: WAIT (No edge)\nConfidence: Low`, color: "white" };
}

module.exports = { actionAgentSignal };
