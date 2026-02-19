#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { runApp } = require("./src/app");

function ensureNode18() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    console.log("❌ Node.js 18+ required.");
    process.exit(1);
  }
}

ensureNode18();

runApp().catch((err) => {
  console.error("\n💥 Fatal:", err?.message || err);
  process.exit(1);
});
