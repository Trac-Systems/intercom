// agents/risk.js
export async function riskGateAgent({ llm, chain, token, context = {} }) {
  const system = `
You are Risk Gate Agent inside an Intercom-style CLI.
Return STRICT JSON ONLY with keys:
status ("SAFE"|"CAUTION"|"BLOCK"), flags (max 4), checklist (max 4).
No markdown.
  `.trim();

  const user = `
chain: ${chain}
token: ${token}
context: ${JSON.stringify(context)}
Give a quick risk gate. If critical -> BLOCK.
  `.trim();

  if (!llm) {
    return {
      status: "CAUTION",
      flags: ["AI not configured (GROQ_API_KEY missing).", "No automatic verification."],
      checklist: ["Check liquidity depth/lock", "Check top holders", "Check tax/honeypot", "Start small size"]
    };
  }

  const out = await llm.json(system, user);
  return {
    status: out?.status || "CAUTION",
    flags: Array.isArray(out?.flags) ? out.flags.slice(0, 4) : [],
    checklist: Array.isArray(out?.checklist) ? out.checklist.slice(0, 4) : []
  };
}
