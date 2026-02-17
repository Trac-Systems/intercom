// agents/analyst.js
// Analyst Agent: uses REAL market data (Dexscreener) + optional Groq AI.

export async function analystAgent({ llm, chain, token, market }) {
  const system = `
You are Analyst Agent inside an Intercom-style CLI.
Be short, practical, and neutral.
Return STRICT JSON ONLY with keys:
- signal: "BUY" | "SELL" | "HOLD"
- why: array of max 3 short bullets
- questions: array of max 2 short questions (only if missing info)
No markdown, no extra text.
  `.trim();

  const user = `
Analyze using REAL market snapshot (Dexscreener):
input_chain: ${chain}
input_token: ${token}

market_snapshot:
${JSON.stringify(market, null, 2)}

Rules:
- No hype, no guarantees
- Prefer HOLD if liquidity is low or data is missing
- why: max 3 bullets
- questions: only if something critical is missing
  `.trim();

  // fallback if no LLM configured
  if (!llm) {
    const liq = Number(market?.liquidity || 0);
    const vol = Number(market?.volume24h || 0);

    let signal = "HOLD";
    const why = [];

    if (!market) {
      why.push("No Dexscreener data found for that query.");
      why.push("Try using a contract address (CA) for accuracy.");
      return { signal, why, questions: ["What is the token contract address (CA)?"] };
    }

    // simple rules (no AI)
    if (liq > 50000 && vol > 50000) {
      signal = "HOLD";
      why.push("Healthy liquidity and volume detected.");
      why.push("Still need confirmation (trend/news) before entries.");
    } else {
      signal = "HOLD";
      why.push("Liquidity/volume looks low or uncertain.");
      why.push("Higher risk of slippage/manipulation.");
    }

    return { signal, why, questions: [] };
  }

  const out = await llm.json(system, user);

  // harden output
  return {
    signal: out?.signal || "HOLD",
    why: Array.isArray(out?.why) ? out.why.slice(0, 3) : [],
    questions: Array.isArray(out?.questions) ? out.questions.slice(0, 2) : []
  };
}
