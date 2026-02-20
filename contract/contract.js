/**
 * TracOracle — Contract (deterministic state machine)
 *
 * Market lifecycle:
 *   open → staking_closed → resolved → payouts_complete
 *           (stake cutoff)  (oracle resolves YES/NO)
 *
 * Every peer runs this identically. No disagreements possible.
 */

'use strict'

import crypto from 'crypto'

export const OUTCOME = { YES: 'yes', NO: 'no', VOID: 'void' }
export const STATE   = { OPEN: 'open', CLOSED: 'closed', RESOLVED: 'resolved', VOID: 'void' }

export default class Contract {

  constructor(db) {
    this.db = db   // Trac-provided persistent K/V store
  }

  // ── WRITE ──────────────────────────────────────────────────────────────────

  /**
   * Create a new prediction market.
   * op: market_create
   * { question, category, closes_in, resolve_by, oracle_address }
   */
  async market_create({ creator, question, category, closes_in, resolve_by, oracle_address }) {
    if (!question || question.trim().length < 10) throw new Error('question must be >= 10 chars')
    if (!oracle_address)                          throw new Error('oracle_address required')

    const CATEGORIES = ['crypto', 'sports', 'politics', 'science', 'tech', 'other']
    if (!CATEGORIES.includes(category)) throw new Error(`category must be one of: ${CATEGORIES.join(', ')}`)

    const now        = Date.now()
    const closes_at  = now + Math.min(Math.max(closes_in  || 3600,  60),  2592000) * 1000  // 1min–30days
    const resolve_at = now + Math.min(Math.max(resolve_by || 7200, 120), 5184000) * 1000  // 2min–60days

    if (resolve_at <= closes_at) throw new Error('resolve_by must be after closes_in')

    const id = crypto.randomUUID()

    const market = {
      id,
      creator,
      question:       question.trim(),
      category,
      oracle_address,
      state:          STATE.OPEN,
      outcome:        null,
      closes_at,
      resolve_at,
      created_at:     now,
      updated_at:     now,
      // Stake pools
      yes_pool:       0,   // total TNK staked YES
      no_pool:        0,   // total TNK staked NO
      yes_stakers:    {},  // { address: amount }
      no_stakers:     {},  // { address: amount }
      claimed:        {},  // { address: true }
    }

    await this.db.put(`market:${id}`, JSON.stringify(market))
    await this._add_to_index(id, STATE.OPEN, category)

    return { ok: true, market_id: id, market }
  }

  /**
   * Stake TNK on a market outcome.
   * op: market_stake
   * { market_id, side: 'yes'|'no', amount }
   */
  async market_stake({ staker, market_id, side, amount }) {
    const market = await this._require_market(market_id)

    if (market.state !== STATE.OPEN)      throw new Error('market is not open for staking')
    if (Date.now() > market.closes_at)    throw new Error('staking period has ended')
    if (!['yes','no'].includes(side))     throw new Error("side must be 'yes' or 'no'")
    if (!amount || amount <= 0)           throw new Error('amount must be > 0')
    if (market.oracle_address === staker) throw new Error('oracle cannot stake on their own market')

    const pool_key    = `${side}_pool`
    const stakers_key = `${side}_stakers`

    market[pool_key]   += amount
    market[stakers_key][staker] = (market[stakers_key][staker] || 0) + amount
    market.updated_at  = Date.now()

    // Close staking if past closes_at (handled here lazily too)
    if (Date.now() > market.closes_at) {
      market.state = STATE.CLOSED
      await this._update_index(market_id, STATE.CLOSED)
    }

    await this.db.put(`market:${market_id}`, JSON.stringify(market))

    return { ok: true, side, amount, yes_pool: market.yes_pool, no_pool: market.no_pool }
  }

  /**
   * Oracle resolves the market.
   * op: market_resolve
   * { market_id, outcome: 'yes'|'no'|'void' }
   */
  async market_resolve({ resolver, market_id, outcome }) {
    const market = await this._require_market(market_id)

    if (market.state === STATE.RESOLVED)        throw new Error('already resolved')
    if (market.state === STATE.VOID)            throw new Error('market is void')
    if (market.oracle_address !== resolver)     throw new Error('only the designated oracle can resolve')
    if (!Object.values(OUTCOME).includes(outcome)) throw new Error("outcome must be 'yes', 'no', or 'void'")

    market.state      = outcome === OUTCOME.VOID ? STATE.VOID : STATE.RESOLVED
    market.outcome    = outcome
    market.updated_at = Date.now()

    await this.db.put(`market:${market_id}`, JSON.stringify(market))
    await this._update_index(market_id, market.state)

    return { ok: true, outcome, yes_pool: market.yes_pool, no_pool: market.no_pool }
  }

  /**
   * Claim winnings after resolution.
   * op: market_claim
   * { market_id }
   */
  async market_claim({ claimant, market_id }) {
    const market = await this._require_market(market_id)

    if (market.state !== STATE.RESOLVED && market.state !== STATE.VOID) {
      throw new Error('market has not been resolved yet')
    }
    if (market.claimed[claimant]) throw new Error('already claimed')

    let payout = 0

    if (market.outcome === OUTCOME.VOID) {
      // Full refund to everyone
      payout  = (market.yes_stakers[claimant] || 0) + (market.no_stakers[claimant] || 0)
    } else {
      const winning_side    = market.outcome                          // 'yes' or 'no'
      const winning_pool    = market[`${winning_side}_pool`]
      const losing_pool     = market[`${winning_side === 'yes' ? 'no' : 'yes'}_pool`]
      const my_winning_stake = market[`${winning_side}_stakers`][claimant] || 0

      if (my_winning_stake === 0) throw new Error('you did not stake on the winning side')

      // Proportional share: my_stake / winning_pool × total_pool
      const total_pool = winning_pool + losing_pool
      payout = Math.floor((my_winning_stake / winning_pool) * total_pool)
    }

    if (payout === 0) throw new Error('nothing to claim')

    market.claimed[claimant] = true
    market.updated_at        = Date.now()
    await this.db.put(`market:${market_id}`, JSON.stringify(market))

    // NOTE: actual TNK transfer via MSB triggered from protocol.js
    return { ok: true, payout, claimant }
  }

  // ── READ ───────────────────────────────────────────────────────────────────

  async market_list({ category, state, limit } = {}) {
    const index = await this._get_index()
    let ids = Object.keys(index)

    if (category) ids = ids.filter(id => index[id].category === category)
    if (state)    ids = ids.filter(id => index[id].state    === state)

    ids = ids.slice(0, Math.min(limit || 20, 100))

    const markets = []
    for (const id of ids) {
      const m = await this.get_market(id)
      if (m) markets.push(this._summary(m))
    }
    return markets.sort((a, b) => b.created_at - a.created_at)
  }

  async get_market(market_id) {
    const raw = await this.db.get(`market:${market_id}`)
    return raw ? JSON.parse(raw) : null
  }

  async my_stakes({ address }) {
    const index = await this._get_index()
    const results = []
    for (const id of Object.keys(index)) {
      const m = await this.get_market(id)
      if (!m) continue
      const yes_stake = m.yes_stakers[address] || 0
      const no_stake  = m.no_stakers[address]  || 0
      if (yes_stake > 0 || no_stake > 0) {
        results.push({ ...this._summary(m), your_yes: yes_stake, your_no: no_stake })
      }
    }
    return results
  }

  // ── INTERNAL ───────────────────────────────────────────────────────────────

  async _require_market(id) {
    const m = await this.get_market(id)
    if (!m) throw new Error(`market not found: ${id}`)
    return m
  }

  _summary(m) {
    return {
      id:             m.id,
      question:       m.question,
      category:       m.category,
      state:          m.state,
      outcome:        m.outcome,
      yes_pool:       m.yes_pool,
      no_pool:        m.no_pool,
      total_pool:     m.yes_pool + m.no_pool,
      closes_at:      m.closes_at,
      resolve_at:     m.resolve_at,
      oracle_address: m.oracle_address,
      created_at:     m.created_at,
    }
  }

  async _get_index() {
    const raw = await this.db.get('index:markets')
    return raw ? JSON.parse(raw) : {}
  }

  async _add_to_index(id, state, category) {
    const idx = await this._get_index()
    idx[id] = { state, category }
    await this.db.put('index:markets', JSON.stringify(idx))
  }

  async _update_index(id, state) {
    const idx = await this._get_index()
    if (idx[id]) { idx[id].state = state; await this.db.put('index:markets', JSON.stringify(idx)) }
  }
}
