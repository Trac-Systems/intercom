// lib/dex.js
// Dexscreener real data (support CA & symbol)

export async function getTokenData(query) {
  try {
    let url;

    // auto detect: contract address vs symbol
    if (query.startsWith("0x") || query.length > 30) {
      url = `https://api.dexscreener.com/latest/dex/tokens/${query}`;
    } else {
      url = `https://api.dexscreener.com/latest/dex/search?q=${query}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }

    const pair = data.pairs[0];

    return {
      name: pair.baseToken?.name || "Unknown",
      symbol: pair.baseToken?.symbol || "Unknown",
      price: pair.priceUsd || "N/A",
      liquidity: pair.liquidity?.usd || 0,
      volume24h: pair.volume?.h24 || 0,
      chain: pair.chainId || "unknown",
      dex: pair.dexId || "unknown"
    };
  } catch (e) {
    return null;
  }
}
