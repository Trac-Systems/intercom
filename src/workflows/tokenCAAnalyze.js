"use strict";

const inquirer = require("inquirer");
const chalk = require("chalk");
const boxen = require("boxen");
const Table = require("cli-table3");

const { fetchDexPairsByCA } = require("../services/dexscreener");
const { clampStr, fmtUsd, fmtNum } = require("../utils/format");

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  // Prefer higher liquidity USD, then higher volume 24h
  const scored = pairs.map((p) => {
    const liq = Number(p?.liquidity?.usd) || 0;
    const vol = Number(p?.volume?.h24) || 0;
    return { p, score: liq * 10 + vol };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].p;
}

async function actionTokenCAAnalyze() {
  const { ca } = await inquirer.prompt([
    {
      type: "input",
      name: "ca",
      message: "Paste Contract Address / Mint (CA):",
      validate: (v) => (String(v || "").trim().length >= 20 ? true : "CA too short")
    }
  ]);

  process.stdout.write("\x1Bc");
  console.log(
    boxen(chalk.magentaBright("🔎 TOKEN CA ANALYZER (DexScreener)"), {
      padding: 1,
      borderStyle: "round",
      borderColor: "magentaBright"
    })
  );
  console.log(chalk.gray(`CA: ${ca}\n`));

  const data = await fetchDexPairsByCA(ca.trim());
  const pairs = data?.pairs || [];
  if (!pairs.length) {
    console.log(boxen(chalk.yellowBright("No pairs found for this CA."), { padding: 1, borderStyle: "round" }));
    await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to return..." }]);
    return;
  }

  const best = pickBestPair(pairs);

  const meta = new Table({ colWidths: [22, 64] });
  meta.push(
    [chalk.whiteBright("Chain"), chalk.cyanBright(best?.chainId || "-")],
    [chalk.whiteBright("DEX"), chalk.cyanBright(best?.dexId || "-")],
    [chalk.whiteBright("Pair"), chalk.whiteBright(clampStr(best?.pairAddress || "-", 60))],
    [chalk.whiteBright("Base"), `${best?.baseToken?.symbol || "-"} • ${clampStr(best?.baseToken?.address || "-", 44)}`],
    [chalk.whiteBright("Quote"), `${best?.quoteToken?.symbol || "-"} • ${clampStr(best?.quoteToken?.address || "-", 44)}`],
    [chalk.whiteBright("Price USD"), chalk.greenBright(fmtUsd(best?.priceUsd))],
    [chalk.whiteBright("FDV"), fmtUsd(best?.fdv)],
    [chalk.whiteBright("Liquidity"), fmtUsd(best?.liquidity?.usd)],
    [chalk.whiteBright("Vol 24h"), fmtUsd(best?.volume?.h24)],
    [chalk.whiteBright("Txns 24h"), fmtNum((best?.txns?.h24?.buys || 0) + (best?.txns?.h24?.sells || 0))]
  );

  const risk = simpleRiskLabel(best);
  console.log(meta.toString() + "\n");
  console.log(risk + "\n");

  const list = pairs.slice(0, 8).map((p, idx) => ({
    idx: idx + 1,
    chain: p.chainId,
    dex: p.dexId,
    liq: Number(p?.liquidity?.usd) || 0,
    vol: Number(p?.volume?.h24) || 0,
    price: p?.priceUsd
  }));

  const t = new Table({
    head: ["#", "Chain", "DEX", "Liquidity(USD)", "Vol24h(USD)", "Price(USD)"].map((x) => chalk.whiteBright(x)),
    colWidths: [4, 10, 14, 18, 16, 14]
  });

  list.forEach((r) => {
    t.push([r.idx, r.chain, r.dex, fmtUsd(r.liq), fmtUsd(r.vol), fmtUsd(r.price)]);
  });

  console.log(chalk.gray("Top pairs:"));
  console.log(t.toString());

  await inquirer.prompt([{ type: "input", name: "x", message: "Press Enter to return to menu..." }]);
}

function simpleRiskLabel(pair) {
  const liq = Number(pair?.liquidity?.usd) || 0;
  const vol = Number(pair?.volume?.h24) || 0;

  // very rough heuristics
  if (liq < 5000) {
    return boxen(chalk.redBright("RISK: HIGH — Low liquidity (easy to rug/impact)."), {
      padding: 1,
      borderStyle: "round",
      borderColor: "redBright"
    });
  }
  if (liq < 25000 && vol < 5000) {
    return boxen(chalk.yellowBright("RISK: MEDIUM — Thin market / low activity."), {
      padding: 1,
      borderStyle: "round",
      borderColor: "yellowBright"
    });
  }
  return boxen(chalk.greenBright("RISK: OK — Liquidity & activity look decent (still DYOR)."), {
    padding: 1,
    borderStyle: "round",
    borderColor: "greenBright"
  });
}

module.exports = { actionTokenCAAnalyze };
