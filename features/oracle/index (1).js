/**
 * TracOracle — Oracle Feature
 *
 * A Feature is a privileged process that runs on indexer/bootstrap nodes.
 * This one:
 *  1. Lazily closes staking on markets past their closes_at timestamp
 *  2. Pings the designated oracle via sidechannel when a market is ready to resolve
 *  3. Voids markets where the oracle missed the resolve_at deadline
 *
 * Runs every 30 seconds.
 */

'use strict'

const TICK_INTERVAL_MS = 30_000

export default class OracleFeature {

  constructor(peer, contract) {
    this.peer     = peer
    this.contract = contract
    this._timer   = null
  }

  start() {
    console.log('[OracleFeature] started — ticking every 30s')
    this.tick()
    this._timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  stop() {
    if (this._timer) clearInterval(this._timer)
  }

  async tick() {
    try {
      const now   = Date.now()
      const index = await this.contract._get_index()

      for (const [market_id, meta] of Object.entries(index)) {
        const market = await this.contract.get_market(market_id)
        if (!market) continue

        // 1. Close staking if past closes_at
        if (market.state === 'open' && now > market.closes_at) {
          console.log(`[OracleFeature] Closing staking for market ${market_id.slice(0,8)}…`)
          market.state      = 'closed'
          market.updated_at = now
          await this.contract.db.put(`market:${market_id}`, JSON.stringify(market))
          await this.contract._update_index(market_id, 'closed')

          // Ping the oracle
          await this.peer.sc_send('tracoracle-activity', JSON.stringify({
            type:           'staking_closed',
            market_id,
            question:       market.question,
            oracle_address: market.oracle_address,
            yes_pool:       market.yes_pool,
            no_pool:        market.no_pool,
            resolve_by:     new Date(market.resolve_at).toISOString(),
          }))
        }

        // 2. Ping oracle again when resolve window is approaching (1 hour before deadline)
        if (market.state === 'closed') {
          const one_hour = 60 * 60 * 1000
          if (now > market.resolve_at - one_hour && now < market.resolve_at) {
            await this.peer.sc_send(`oracle:${market.oracle_address}`, JSON.stringify({
              type:     'resolve_reminder',
              market_id,
              question: market.question,
              deadline: new Date(market.resolve_at).toISOString(),
            }))
          }
        }

        // 3. Void market if oracle missed the deadline
        if (market.state === 'closed' && now > market.resolve_at) {
          console.log(`[OracleFeature] Voiding overdue market ${market_id.slice(0,8)}…`)
          market.state      = 'void'
          market.outcome    = 'void'
          market.updated_at = now
          await this.contract.db.put(`market:${market_id}`, JSON.stringify(market))
          await this.contract._update_index(market_id, 'void')

          await this.peer.sc_send('tracoracle-activity', JSON.stringify({
            type:     'market_voided',
            market_id,
            reason:   'oracle_missed_deadline',
          }))
        }
      }
    } catch (err) {
      console.error('[OracleFeature] tick error:', err.message)
    }
  }
}
