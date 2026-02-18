console.clear();

console.log(`
========================================
        AXELNODE AI INTERCOM
========================================
Mode        : Web3 Signal + Education
Author      : Axel
Build       : Standalone CLI Version
========================================
`);

const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("AxelNode is LIVE and listening...");
console.log("Type your question below.\n");

function respond(text) {
  text = text.toLowerCase();

  if (text.includes("tokenomics")) {
    return `📊 TOKENOMICS BREAKDOWN
• Total / Max Supply
• Distribution (Team vs Community)
• Utility & Real Use Case
• Inflation / Emission Model`;
  }

  if (text.includes("liquidity")) {
    return `💧 LIQUIDITY EXPLAINED
Liquidity pools allow token swaps.
Low liquidity = high volatility.
Always check LP lock status.`;
  }

  if (text.includes("swap")) {
    return `🔁 SAFE SWAP GUIDE
1. Verify contract address
2. Confirm correct network
3. Adjust slippage carefully
4. Review before signing`;
  }

  if (text.includes("safe")) {
    return `⚠️ BASIC RISK CHECK
• Check contract verification
• Review holder distribution
• Look for liquidity lock
• Avoid anonymous devs`;
  }

  return `🤖 AxelNode Active

Ask about:
• tokenomics
• liquidity
• swap
• is this safe`;
}

rl.on("line", (input) => {
  const reply = respond(input);
  console.log("\nAxelNode:");
  console.log(reply);
  console.log("\n----------------------------------\n");
});