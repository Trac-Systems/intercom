"use strict";

const axios = require("axios");
const { config } = require("../config");

const http = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: config.COINGECKO_TIMEOUT_MS,
  headers: {
    "accept": "application/json"
  }
});

// Simple price + 24h stats
async function fetchCoinGeckoSimplePrice(coinId, vs) {
  const url = "/simple/price";
  const params = {
    ids: coinId,
    vs_currencies: vs,
    include_24hr_change: true,
    include_24hr_high: true,
    include_24hr_low: true,
    include_24hr_vol: true
  };
  const { data } = await http.get(url, { params });
  return data;
}

// OHLC for mini chart (days: 1, 7, 30, 90, 180, 365, max)
async function fetchCoinGeckoOHLC(coinId, vs, days = "1") {
  const url = `/coins/${encodeURIComponent(coinId)}/ohlc`;
  const params = { vs_currency: vs, days };
  const { data } = await http.get(url, { params });
  return data;
}

// Market chart prices for indicators
async function fetchCoinGeckoMarketChart(coinId, vs, days = "1") {
  const url = `/coins/${encodeURIComponent(coinId)}/market_chart`;
  const params = { vs_currency: vs, days };
  const { data } = await http.get(url, { params });
  return data;
}

module.exports = {
  fetchCoinGeckoSimplePrice,
  fetchCoinGeckoOHLC,
  fetchCoinGeckoMarketChart
};
