import readline from "readline";

/**
 * INTERCOM_BY_GAMBER8 — Pro CLI
 * - Agent Mode (Real Data) + Q&A
 * - Swap Link Generator (Jupiter / 1inch)
 * - Risk Check (Real Data)
 *
 * Optional AI:
 *   export GROQ_API_KEY="..."
 *   export GROQ_MODEL="llama-3.3-70b-versatile"
 */

// ========= CLI =========
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res((a ?? "").trim())));

// ========= UI Helpers =========
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  mag: "\x1b[35m",
};

function hr() {
  console.log(`${C.dim}────────────────────────────────────────${C.reset}`);
}
function title(t) {
  hr();
  console.log(`${C.bold}${C.cyan}${t}${C.reset}`);
  hr();
}
function badge(text, type = "info") {
  const color = type === "ok" ? C.green : type === "warn" ? C.yellow : type === "bad" ? C.red : C.cyan;
  return `${color}${C.bold}${text}${C.reset}`;
}
function line(k, v) {
  console.log(`${C.dim}${k}:${C.reset} ${v}`);
}
function fmtUSD(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "N/A";
  if (x >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(2)}K`;
  return `$${x.toFixed(2)}`;
}

// ========= Groq (Optional) =========
function createLLM() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const baseURL = "https://api.groq.com/openai/v1";
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  async function json(system, user) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system + "\nReturn STRICT JSON only. No markdown." },
          { role: "user", content: user },
        ],
      }),
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "{}";

    // defensive JSON parse
    try {
      return JSON.parse(text);
    } catch {
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s !== -1 && e !== -1) {
        try {
          return JSON.parse(text.slice(s, e + 1));
        } catch {}
      }
      return {};
    }
  }

  return { json };
}

// ========= Dexscreener Real Data =========
async function getTokenData(query) {
  try {
    let url;
    // detect CA (0x... or long string)
    if ((query || "").startsWith("0x") || (query || "").length > 30) {
      url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(query)}`;
    } else {
      url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!data?.pairs?.length) return null;

    const p = data.pairs[0];
    return {
      name: p.baseToken?.name || "Unknown",
      symbol: p.baseToken?.symbol || "Unknown",
      pairAddress: p.pairAddress || "",
      chain: p.chainId || "unknown",
      dex: p.dexId || "unknown",
      price: p.priceUsd || "N/A",
      liquidity: p.liquidity?.usd || 0,
      volume24h: p.volume?.h24 || 0,
      fdv: p.fdv || 0,
      url: p.url || "",
    };
  } catch {
    return null;
  }
}

// ========= Agents (Analyst + Risk Gate) =========
async function analystAgent({ llm, chainHint, token, market }) {
  // fallback rule-based
  if (!llm) {
    if (!market) {
      return {
        signal: "HOLD",
        why: ["No Dexscreener data found.", "Try using a contract address (CA) for accuracy."],
        questions: ["What is the token contract address (CA)?"],
      };
    }
    const liq = Number(market.liquidity || 0);
    const vol = Number(market.volume24h || 0);

    // simple heuristic
    let signal = "HOLD";
    const why = [];

    if (liq < 10000) {
      why.push("Low liquidity → high slippage/manipulation risk.");
      signal = "HOLD";
    } else {
      why.push("Liquidity looks acceptable for basic swaps.");
    }

    if (vol < 10000) {
      why.push("Low 24h volume → weak confirmation.");
      signal = "HOLD";
    } else {
      why.push("24h volume shows activity (still not a guarantee).");
    }

    why.push("Market conditions can change fast.");
    return { signal, why: why.slice(0, 3), questions: [] };
  }

  const system = `
You are Analyst Agent in an Intercom-style CLI.
Return STRICT JSON with keys:
signal ("BUY"|"SELL"|"HOLD"), why (max 3 bullets), questions (max 2).
No hype, no promises.
`.trim();

  const user = `
User input:
chain_hint: ${chainHint}
token: ${token}

REAL market snapshot (Dexscreener):
${JSON.stringify(market, null, 2)}

Give a practical signal based on the snapshot.
If critical info missing, ask 1-2 questions.
`.trim();

  const out = await llm.json(system, user);
  return {
    signal: out?.signal || "HOLD",
    why: Array.isArray(out?.why) ? out.why.slice(0, 3) : [],
    questions: Array.isArray(out?.questions) ? out.questions.slice(0, 2) : [],
  };
}

async function riskGateAgent({ llm, chainHint, token, market, analystSignal }) {
  // fallback rule-based
  if (!llm) {
    if (!market) {
      return {
        status: "CAUTION",
        flags: ["No market data found.", "Risk can’t be verified automatically."],
        checklist: ["Use CA to fetch correct token", "Check liquidity depth", "Check top holders", "Start very small"],
      };
    }

    const liq = Number(market.liquidity || 0);
    const vol = Number(market.volume24h || 0);
    const flags = [];
    let status = "SAFE";

    if (liq < 5000) {
      status = "BLOCK";
      flags.push("Very low liquidity (high rug/slippage risk).");
    } else if (liq < 20000) {
      status = "CAUTION";
      flags.push("Low-ish liquidity (slippage risk).");
    }

    if (vol < 5000) {
      status = status === "BLOCK" ? "BLOCK" : "CAUTION";
      flags.push("Very low 24h volume (easy to manipulate).");
    }

    if ((market.price || "N/A") === "N/A") {
      status = status === "BLOCK" ? "BLOCK" : "CAUTION";
      flags.push("Price data missing/unstable.");
    }

    if (analystSignal === "BUY" && status !== "BLOCK") {
      flags.push("Even if BUY: use tight risk management.");
    }

    const checklist = [
      "Verify contract is correct (CA)",
      "Check liquidity lock / LP holders",
      "Check top holders concentration",
      "Test with tiny amount first",
    ];

    return { status, flags: flags.slice(0, 4), checklist: checklist.slice(0, 4) };
  }

  const system = `
You are Risk Gate Agent in an Intercom-style CLI.
Return STRICT JSON with keys:
status ("SAFE"|"CAUTION"|"BLOCK"),
flags (max 4),
checklist (max 4).
No markdown, keep it practical.
`.trim();

  const user = `
User input:
chain_hint: ${chainHint}
token: ${token}
analyst_signal: ${analystSignal}

REAL market snapshot:
${JSON.stringify(market, null, 2)}

Decide risk status. If critical red flags -> BLOCK.
`.trim();

  const out = await llm.json(system, user);
  return {
    status: out?.status || "CAUTION",
    flags: Array.isArray(out?.flags) ? out.flags.slice(0, 4) : [],
    checklist: Array.isArray(out?.checklist) ? out.checklist.slice(0, 4) : [],
  };
}

// ========= Swap Link Generator =========
function makeSwapLink({ chain, fromToken, toToken, amount }) {
  const c = (chain || "").toLowerCase();

  // Solana Jupiter link (works with symbol too; best with mint)
  if (["sol", "solana"].includes(c)) {
    return `https://jup.ag/swap/${encodeURIComponent(fromToken)}-${encodeURIComponent(toToken)}?amount=${encodeURIComponent(
      amount || ""
    )}`;
  }

  // EVM: 1inch universal UI
  // NOTE: user picks network in UI; this is safe and simple.
  if (["eth", "ethereum", "bsc", "base", "arb", "arbitrum", "op", "optimism", "polygon"].includes(c)) {
    return `https://app.1inch.io/#/${encodeURIComponent(fromToken)}/${encodeURIComponent(toToken)}`;
  }

  return null;
}

// ========= Q&A Mode =========
async function chatWithAgents({ llm, context }) {
  title("Q&A MODE");
  console.log(`${C.dim}Type your question. Type${C.reset} ${C.bold}exit${C.reset} ${C.dim}to go back.${C.reset}\n`);

  while (true) {
    const q = await ask(`${badge("YOU", "info")} `);
    if (!q) continue;
    if (q.toLowerCase() === "exit") break;

    if (!llm) {
      // fallback: answer from context with simple heuristics
      const m = context?.market;
      const a = context?.analyst;
      const r = context?.risk;

      console.log(`${badge("AGENT", "ok")} ${C.dim}(offline mode)${C.reset}`);
      if (/why|kenapa|reason/i.test(q)) {
        console.log(`- Signal: ${a?.signal || "HOLD"}`);
        (a?.why || []).forEach((x) => console.log(`- ${x}`));
      } else if (/risk|bahaya|flag/i.test(q)) {
        console.log(`- Status: ${r?.status || "CAUTION"}`);
        (r?.flags || []).forEach((x) => console.log(`- ${x}`));
      } else if (/data|market|price|liq|volume/i.test(q)) {
        if (!m) console.log("- No market data available.");
        else {
          console.log(`- ${m.name} (${m.symbol})`);
          console.log(`- Price: ${m.price}`);
          console.log(`- Liquidity: ${fmtUSD(m.liquidity)}`);
          console.log(`- Volume 24h: ${fmtUSD(m.volume24h)}`);
        }
      } else {
        console.log("- Ask about: why signal, risk flags, or market data.");
        console.log("- Tip: use CA for accurate results.");
      }
      console.log("");
      continue;
    }

    const system = `
You are an Intercom-style assistant for a trading copilot CLI.
Be concise. No hype. No financial guarantees.
Answer based on the provided context only.
`.trim();

    const user = `
Context JSON:
${JSON.stringify(context, null, 2)}

User question:
${q}

Answer in 3-8 short lines max.
`.trim();

    try {
      // Use Groq but not JSON this time; we’ll call json() and wrap response
      // We'll cheat by asking JSON with key "answer" to reuse strict parser.
      const out = await llm.json(
        system + "\nReturn STRICT JSON with key: answer (string).",
        user + "\nReturn JSON: {\"answer\":\"...\"}"
      );
      const ans = out?.answer || "No answer.";
      console.log(`${badge("AGENT", "ok")}\n${ans}\n`);
    } catch {
      console.log(`${badge("AGENT", "warn")} Could not answer right now.\n`);
    }
  }
}

// ========= Modes =========
async function runAgentMode() {
  const llm = createLLM();

  title("AGENT MODE — REAL DATA");
  console.log(`${C.dim}Tip:${C.reset} Use ${C.bold}contract address (CA)${C.reset} for best accuracy.\n`);

  const chainHint = await ask("Chain hint (sol/eth/bsc/base) [optional]: ");
  const token = await ask("Token (symbol or CA): ");

  console.log(`\n${badge("DATA", "info")} Fetching Dexscreener...`);
  const market = await getTokenData(token);

  if (!market) {
    console.log(`${badge("WARN", "warn")} No Dexscreener pairs found.`);
    console.log(`${C.dim}Try CA instead (0x...) or a more specific query.${C.reset}\n`);
  } else {
    title("MARKET SNAPSHOT");
    line("Name", `${market.name} (${market.symbol})`);
    line("Chain / DEX", `${market.chain} / ${market.dex}`);
    line("Price", `${market.price}`);
    line("Liquidity", `${fmtUSD(market.liquidity)}`);
    line("Volume 24h", `${fmtUSD(market.volume24h)}`);
    if (market.fdv) line("FDV", fmtUSD(market.fdv));
    if (market.url) line("Dex URL", market.url);
    hr();
    console.log("");
  }

  title("AGENT: ANALYST");
  const analyst = await analystAgent({ llm, chainHint, token, market });
  console.log(`${badge("SIGNAL", analyst.signal === "BUY" ? "ok" : analyst.signal === "SELL" ? "bad" : "warn")} ${C.bold}${analyst.signal}${C.reset}`);
  (analyst.why || []).forEach((x) => console.log(`- ${x}`));
  if (analyst.questions?.length) {
    console.log(`\n${badge("QUESTIONS", "info")}`);
    analyst.questions.forEach((q) => console.log(`- ${q}`));
  }

  title("AGENT: RISK GATE");
  const risk = await riskGateAgent({
    llm,
    chainHint,
    token,
    market,
    analystSignal: analyst.signal,
  });

  const st = risk.status || "CAUTION";
  console.log(`${badge("STATUS", st === "SAFE" ? "ok" : st === "BLOCK" ? "bad" : "warn")} ${C.bold}${st}${C.reset}`);
  (risk.flags || []).forEach((x) => console.log(`- ${x}`));

  console.log(`\n${badge("CHECKLIST", "info")}`);
  (risk.checklist || []).forEach((x) => console.log(`- ${x}`));

  title("DECISION");
  if (st === "BLOCK") {
    console.log(`${badge("RESULT", "bad")} ${C.bold}DO NOT TRADE${C.reset}`);
  } else if (st === "CAUTION") {
    console.log(`${badge("RESULT", "warn")} ${C.bold}SMALL SIZE / WAIT${C.reset}`);
  } else {
    console.log(`${badge("RESULT", "ok")} ${C.bold}OK TO PROCEED (manage risk)${C.reset}`);
  }
  console.log("");

  // Q&A option
  const openQA = await ask(`${C.dim}Open Q&A mode? (y/n): ${C.reset}`);
  if (openQA.toLowerCase() === "y") {
    await chatWithAgents({
      llm,
      context: { chainHint, token, market, analyst, risk },
    });
  }
}

async function runSwapLinkMode() {
  title("SWAP — LINK GENERATOR");
  console.log(`${C.dim}Safe mode:${C.reset} generates a swap link (no private key, no execution).\n`);

  const chain = await ask("Chain (sol/eth/bsc/base): ");
  const fromToken = await ask("From (symbol or mint/CA): ");
  const toToken = await ask("To (symbol or mint/CA): ");
  const amount = await ask("Amount (optional): ");

  const link = makeSwapLink({ chain, fromToken, toToken, amount });

  if (!link) {
    console.log(`${badge("WARN", "warn")} Unknown chain. Use: sol / eth / bsc / base / arb / op / polygon\n`);
    return;
  }

  title("SWAP LINK");
  console.log(link);
  console.log(`\n${C.dim}Tip:${C.reset} Open link in browser, connect wallet, confirm swap manually.\n`);
}

async function runRiskOnlyMode() {
  const llm = createLLM();

  title("RISK CHECK — REAL DATA");
  console.log(`${C.dim}Tip:${C.reset} Use CA for accuracy.\n`);

  const chainHint = await ask("Chain hint (sol/eth/bsc/base) [optional]: ");
  const token = await ask("Token (symbol or CA): ");

  console.log(`\n${badge("DATA", "info")} Fetching Dexscreener...`);
  const market = await getTokenData(token);

  if (!market) {
    console.log(`${badge("WARN", "warn")} No Dexscreener pairs found.\n`);
    return;
  }

  title("MARKET SNAPSHOT");
  line("Name", `${market.name} (${market.symbol})`);
  line("Chain / DEX", `${market.chain} / ${market.dex}`);
  line("Price", `${market.price}`);
  line("Liquidity", `${fmtUSD(market.liquidity)}`);
  line("Volume 24h", `${fmtUSD(market.volume24h)}`);
  hr();
  console.log("");

  const risk = await riskGateAgent({ llm, chainHint, token, market, analystSignal: "HOLD" });

  title("RISK GATE RESULT");
  const st = risk.status || "CAUTION";
  console.log(`${badge("STATUS", st === "SAFE" ? "ok" : st === "BLOCK" ? "bad" : "warn")} ${C.bold}${st}${C.reset}`);
  (risk.flags || []).forEach((x) => console.log(`- ${x}`));

  console.log(`\n${badge("CHECKLIST", "info")}`);
  (risk.checklist || []).forEach((x) => console.log(`- ${x}`));
  console.log("");
}

// ========= Main Menu =========
async function mainMenu() {
  while (true) {
    title("INTERCOM_BY_GAMBER8");
    console.log(`${badge("1", "info")} Agent Mode (Real Data + Q&A)`);
    console.log(`${badge("2", "info")} Swap (Link Generator)`);
    console.log(`${badge("3", "info")} Risk Check (Real Data)`);
    console.log(`${badge("4", "info")} Exit`);
    console.log("");

    const choice = await ask("Select option: ");

    if (choice === "1") await runAgentMode();
    else if (choice === "2") await runSwapLinkMode();
    else if (choice === "3") await runRiskOnlyMode();
    else if (choice === "4") {
      console.log("Bye!");
      rl.close();
      process.exit(0);
    } else {
      console.log(`${badge("WARN", "warn")} Invalid option\n`);
    }
  }
}

mainMenu();
