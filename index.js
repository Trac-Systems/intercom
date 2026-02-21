/**
 * TracOracle — P2P Prediction Market on Trac Network
 * Fork of: https://github.com/Trac-Systems/intercom
 *
 * Agents and humans create YES/NO prediction markets, stake TNK,
 * an oracle resolves the outcome, and winners split the pool.
 *
 * Usage: pear run . store1
 *        pear run . store2 --subnet-bootstrap <hex-from-store1>
 */

'use strict'

import Peer from 'trac-peer'
import { Oracle } from './features/oracle/index.js'

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// After first run, replace with your Bootstrap's subnet-bootstrap hex
// (copied from terminal output), then re-run.
const config = {
  // Channel name — exactly 32 chars
  channel: 'tracoracle-mainnet-v1-000000000',

  contract: './contract/contract.js',
  protocol: './contract/protocol.js',

  features: [
    './features/oracle/index.js',
    './features/sidechannel/index.js',
  ],

  // Expose HTTP API so external agents/wallets can interact
  api_tx_exposed:  true,
  api_msg_exposed: true,
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
const peer = new Peer(config)

peer.on('ready', (info) => {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   TracOracle — P2P Prediction Markets    ║')
  console.log('╚══════════════════════════════════════════╝\n')
  console.log(`Peer Address : ${info.address}`)
  console.log(`Writer Key   : ${info.writer_key}`)
  console.log(`Channel      : ${config.channel}\n`)
  console.log('Commands (all use /tx --command \'{ ... }\'):')
  console.log('  market_create   — create a new prediction market')
  console.log('  market_list     — list open markets')
  console.log('  market_get      — get one market by id')
  console.log('  market_stake    — stake TNK on YES or NO')
  console.log('  market_resolve  — resolve with outcome (oracle only)')
  console.log('  market_claim    — claim winnings after resolution')
  console.log('  my_stakes       — show all your active stakes')
  console.log('\nFull examples in README.md\n')
})

// Sidechannel: receive live market activity notifications
peer.on('sc_message', (msg) => {
  try {
    const data = JSON.parse(msg.data)
    switch (data.type) {
      case 'stake_placed':
        console.log(`\n📊 [${msg.channel}] New stake on market #${data.market_id.slice(0,8)}… — ${data.side.toUpperCase()} ${data.amount} TNK by ${data.staker.slice(0,8)}…`)
        break
      case 'market_resolved':
        console.log(`\n🏁 [${msg.channel}] Market #${data.market_id.slice(0,8)}… RESOLVED → ${data.outcome.toUpperCase()}`)
        break
      case 'winnings_claimed':
        console.log(`\n💰 [${msg.channel}] ${data.winner.slice(0,8)}… claimed ${data.amount} TNK from market #${data.market_id.slice(0,8)}…`)
        break
    }
  } catch (_) {}
})

peer.start()
