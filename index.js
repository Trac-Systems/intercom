// DegenOracle — Degen Horoscope Bot
// Fork of Trac-Systems/intercom
// Built for the Intercom Vibe Competition
// Trac payout address: trac18js59cjgh7lqnmf0g9yd44kyucpua55lf33lpjvpcqw4ljgew8tswzaj3k

import crypto from 'crypto'

// ─── Horoscope data pools ─────────────────────────────────────────────────────

const SIGNS = [
  'Bullish Aries', 'Diamond-Handed Taurus', 'Volatile Gemini', 'Bearish Cancer',
  'Maxi Leo', 'Degen Virgo', 'Balanced Libra', 'Rekt Scorpio',
  'Moon-Chasing Sagittarius', 'Hodl Capricorn', 'Airdrop Aquarius', 'Liquidated Pisces'
]

const OUTLOOKS = ['bullish', 'bearish', 'crab']

const RISK_LEVELS = ['low', 'medium', 'degen', 'ape']

const LUCKY_TOKENS = [
  'BTC', 'TRAC', 'TNK', 'ETH', 'SOL', 'PEPE', 'WIF', 'BONK',
  'ARB', 'OP', 'MATIC', 'AVAX', 'LINK', 'INJ', 'TIA', 'SUI',
  'TAP', 'ORDI', 'SATS', 'RATS'
]

const TIPS = [
  'The stars say: zoom out.',
  'Your lucky number is the number of times you checked prices today. Stop.',
  'Mercury is in retrograde. Do not ape in.',
  'The moon is full. Your bags are not.',
  'Today is a good day to touch grass.',
  'Saturn says: your stop-loss is not optional.',
  'The cosmos align for those who DCA.',
  'A wise degen knows when to close the chart.',
  'Your ancestors never paper-handed. Neither should you.',
  'The oracle sees green candles — but also sees your leverage.',
  'Today: buy the rumour, sell the news. Or don\'t. The stars are vague.',
  'Even the cosmos have drawdowns.',
  'The void stares back. Your PnL also stares back.',
  'Patience is a virtue. So is a hardware wallet.',
  'What the market takes, the market can return. Maybe.',
  'Not your keys, not your horoscope.',
  'The stars do not give financial advice. Neither does this bot.',
  'A rising tide lifts all boats. Except the ones that got rugged.',
  'Venus aligns with Jupiter: altseason vibes detected.',
  'Today\'s energy: accumulate in silence, flex at ATH.'
]

const READINGS = [
  'The celestial bodies have examined your wallet history and found it... interesting. Today the universe urges patience. A period of consolidation may feel like stagnation, but the stars know better. Keep your keys safe and your emotions off-chain.',
  'Cosmic forces are stirring in the mempool. Your address carries the energy of someone who once sold the bottom. Today is a day for reflection, not reaction. The blockchain remembers everything — let it be a lesson.',
  'The oracle detects strong on-chain conviction in your Trac address. Today favors those who hold steady. The noise is loud but the signal is clear: accumulate, breathe, and never share your seed phrase.',
  'Your wallet has witnessed many cycles. The stars see resilience in your address. Today brings volatile energy — the kind that separates diamond hands from paper ones. Trust the protocol, not the price.',
  'The cosmos are sending mixed signals today, much like a 4-hour chart with no clear trend. Your best move is to do nothing dramatic. Let others chase candles. You are built different.',
  'A rare alignment between Saturn and the mempool suggests an incoming opportunity. Your Trac address vibrates at a frequency the market will eventually recognize. The stars say: be early, be patient, be solvent.',
  'The celestial audit of your address reveals a spirit forged in bear markets. Today\'s reading is simple: you have survived worse. The next cycle belongs to those still standing.',
  'Mercury retrograde has entered the liquidity pool. Avoid rash decisions, leveraged positions, and clicking unfamiliar contract addresses. The stars protect the cautious degen.',
  'Your cosmic portfolio review shows above-average resilience. Today the universe wants you to take profit — not necessarily financial profit, but definitely touch some grass and log off for a few hours.',
  'The oracle sees two paths before your Trac address: one paved with conviction, one with FOMO. The stars strongly recommend the first. The second path leads through a liquidation zone.'
]

// ─── Core horoscope generation ────────────────────────────────────────────────

function getTodayUTC () {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
}

function generateHoroscope (address) {
  const date = getTodayUTC()
  const seed = `${address}:${date}`
  const hash = crypto.createHash('sha256').update(seed).digest()

  const signIdx = hash[0] % SIGNS.length
  const outlookIdx = hash[1] % OUTLOOKS.length
  const riskIdx = hash[2] % RISK_LEVELS.length
  const tokenIdx = hash[3] % LUCKY_TOKENS.length
  const tipIdx = hash[4] % TIPS.length
  const readingIdx = hash[5] % READINGS.length

  return {
    date,
    address_short: address.slice(0, 12) + '...' + address.slice(-6),
    sign: SIGNS[signIdx],
    outlook: OUTLOOKS[outlookIdx],
    risk_level: RISK_LEVELS[riskIdx],
    lucky_token: LUCKY_TOKENS[tokenIdx],
    tip: TIPS[tipIdx],
    reading: READINGS[readingIdx]
  }
}

function formatHoroscope (h) {
  const outlookEmoji = { bullish: '🟢', bearish: '🔴', crab: '🦀' }[h.outlook]
  const riskEmoji = { low: '🛡️', medium: '⚡', degen: '🎰', ape: '🦍' }[h.risk_level]

  return [
    `╔══════════════════════════════════════╗`,
    `║       🔮 DEGEN ORACLE — ${h.date}   ║`,
    `╚══════════════════════════════════════╝`,
    ``,
    `  Wallet : ${h.address_short}`,
    `  Sign   : ${h.sign}`,
    `  Outlook: ${outlookEmoji} ${h.outlook.toUpperCase()}`,
    `  Risk   : ${riskEmoji} ${h.risk_level.toUpperCase()}`,
    `  Lucky  : 🪙 $${h.lucky_token}`,
    ``,
    `  📜 Reading:`,
    `  ${h.reading}`,
    ``,
    `  💬 Tip: ${h.tip}`,
    ``,
    `  ─────────────────────────────────────`,
    `  Built on Intercom · Trac Network`
  ].join('\n')
}

// ─── State (in-memory community feed, mirrors contract state in real deploy) ──

const communityFeed = []

// ─── Command handler (plugs into Intercom's /tx --command interface) ──────────

function handleCommand (commandStr) {
  let cmd
  try {
    cmd = typeof commandStr === 'string' ? JSON.parse(commandStr) : commandStr
  } catch (e) {
    return { error: 'Invalid JSON command' }
  }

  const { op, address, limit = 10 } = cmd

  if (op === 'horoscope_get') {
    if (!address) return { error: 'address is required' }
    const h = generateHoroscope(address)
    console.log('\n' + formatHoroscope(h) + '\n')
    return { ok: true, horoscope: h }
  }

  if (op === 'horoscope_broadcast') {
    if (!address) return { error: 'address is required' }
    const h = generateHoroscope(address)
    const entry = {
      address_short: h.address_short,
      sign: h.sign,
      outlook: h.outlook,
      risk_level: h.risk_level,
      lucky_token: h.lucky_token,
      tip: h.tip,
      timestamp: new Date().toISOString()
    }
    // Remove previous entry from same address if exists
    const idx = communityFeed.findIndex(e => e.address_short === entry.address_short)
    if (idx !== -1) communityFeed.splice(idx, 1)
    communityFeed.unshift(entry)
    if (communityFeed.length > 100) communityFeed.pop()

    console.log(`\n📡 Broadcast: ${entry.address_short} | ${entry.sign} | ${entry.outlook} | $${entry.lucky_token}`)
    console.log(`   "${entry.tip}"`)
    return { ok: true, broadcasted: entry }
  }

  if (op === 'horoscope_feed') {
    const today = getTodayUTC()
    const feed = communityFeed.slice(0, Math.min(limit, 50))
    console.log(`\n📜 Community Horoscope Feed — ${today}`)
    console.log(`   ${feed.length} reading(s) today:\n`)
    feed.forEach((e, i) => {
      const outlookEmoji = { bullish: '🟢', bearish: '🔴', crab: '🦀' }[e.outlook] || '⚪'
      console.log(`  ${i + 1}. ${e.address_short}`)
      console.log(`     ${e.sign} · ${outlookEmoji} ${e.outlook} · 🪙 $${e.lucky_token}`)
      console.log(`     "${e.tip}"`)
      console.log()
    })
    return { ok: true, feed }
  }

  if (op === 'lucky_token') {
    if (!address) return { error: 'address is required' }
    const h = generateHoroscope(address)
    console.log(`\n🪙 Lucky token for ${h.address_short} today: $${h.lucky_token}`)
    return { ok: true, address_short: h.address_short, lucky_token: h.lucky_token, date: h.date }
  }

  return { error: `Unknown op: ${op}. Valid ops: horoscope_get, horoscope_broadcast, horoscope_feed, lucky_token` }
}

// ─── Demo / standalone runner ─────────────────────────────────────────────────

function runDemo () {
  console.log('\n🔮 DegenOracle — Degen Horoscope Bot')
  console.log('   Built on Intercom · Trac Network')
  console.log('   github.com/danFabCode/intercom\n')

  const testAddress = 'trac18js59cjgh7lqnmf0g9yd44kyucpua55lf33lpjvpcqw4ljgew8tswzaj3k'

  console.log('── Demo: horoscope_get ──────────────────')
  handleCommand({ op: 'horoscope_get', address: testAddress })

  console.log('\n── Demo: horoscope_broadcast ────────────')
  handleCommand({ op: 'horoscope_broadcast', address: testAddress })

  // Simulate a few more peers broadcasting
  const fakePeers = [
    'trac1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz',
    'trac1zzz999yyy888xxx777www666vvv555uuu444ttt333sss222rrr',
    'trac1qqqpppooonnmmmlllkkkjjjiiihhhgggfffeeedddcccbbb111'
  ]
  fakePeers.forEach(p => handleCommand({ op: 'horoscope_broadcast', address: p }))

  console.log('\n── Demo: horoscope_feed ─────────────────')
  handleCommand({ op: 'horoscope_feed', limit: 5 })

  console.log('\n── Demo: lucky_token ────────────────────')
  handleCommand({ op: 'lucky_token', address: testAddress })
}

// ─── Intercom integration hook ────────────────────────────────────────────────
// In a full Pear/Intercom deployment this module exports handleCommand so the
// Intercom runtime can route /tx --command calls to it.
// When run standalone (node index.js) it runs the demo instead.

const args = process.argv.slice(2)
const cmdFlag = args.indexOf('--command')
if (cmdFlag !== -1 && args[cmdFlag + 1]) {
  handleCommand(args[cmdFlag + 1])
} else {
  runDemo()
}

export { handleCommand, generateHoroscope, formatHoroscope }
