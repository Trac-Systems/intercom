// features/swapLink.js
// Simple swap link generator (safe, no private key, no execution)

export function makeSwapLink({ chain, fromToken, toToken, amount }) {
  const c = (chain || "").toLowerCase();

  // EVM chains -> use 1inch web (universal & simple)
  // User can connect wallet in browser and swap.
  if (["eth", "ethereum", "bsc", "base", "arb", "arbitrum", "op", "optimism", "polygon"].includes(c)) {
    // 1inch supports many networks; user picks network in UI
    return `https://app.1inch.io/#/${encodeURIComponent(fromToken)}/${encodeURIComponent(toToken)}`;
  }

  // Solana -> Jupiter swap link
  if (["sol", "solana"].includes(c)) {
    // Jupiter uses input/output mint; if user doesn't have mints, they can still open app and search
    return `https://jup.ag/swap/${encodeURIComponent(fromToken)}-${encodeURIComponent(toToken)}?amount=${encodeURIComponent(amount || "")}`;
  }

  // fallback
  return null;
}
