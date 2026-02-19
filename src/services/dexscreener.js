"use strict";

const axios = require("axios");
const { config } = require("../config");

const http = axios.create({
  baseURL: "https://api.dexscreener.com",
  timeout: config.DEXSCREENER_TIMEOUT_MS,
  headers: {
    "accept": "application/json"
  }
});

async function fetchDexPairsByCA(ca) {
  const url = `/latest/dex/tokens/${encodeURIComponent(ca)}`;
  const { data } = await http.get(url);
  return data;
}

module.exports = { fetchDexPairsByCA };
