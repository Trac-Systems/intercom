/**
 * TracOracle — Protocol
 * Routes incoming /tx --command transactions to contract methods.
 * Validates inputs before passing to the deterministic contract.
 *
 * All ops called via: /tx --command '{ "op": "...", ...args }'
 */

'use strict'

export default class Protocol {

  constructor(contract, peer) {
    this.contract = contract
    this.peer     = peer
  }

  // ── DISPATCH ───────────────────────────────────────────────────────────────

  async exec(tx) {
    const { op, ...args } = tx.command
    const signer = tx.signer  // verified Ed25519 address of caller

    switch (op) {

      case 'market_create':
        return this.contract.market_create({ creator: signer, ...args })

      case 'market_stake': {
        const result = await this.contract.market_stake({ staker: signer, ...args })
        // Broadcast to sidechannel so other peers see live activity
        await this.peer.sc_send('tracoracle-activity', JSON.stringify({
          type:      'stake_placed',
          market_id: args.market_id,
          side:      args.side,
          amount:    args.amount,
          staker:    signer,
        }))
        return result
      }

      case 'market_resolve': {
        const result = await this.contract.market_resolve({ resolver: signer, ...args })
        await this.peer.sc_send('tracoracle-activity', JSON.stringify({
          type:      'market_resolved',
          market_id: args.market_id,
          outcome:   args.outcome,
        }))
        return result
      }

      case 'market_claim': {
        const result = await this.contract.market_claim({ claimant: signer, ...args })
        // Trigger MSB payout to claimant
        if (result.ok && result.payout > 0) {
          await this.peer.msb_transfer({
            to:     signer,
            amount: result.payout,
            memo:   `TracOracle winnings: ${args.market_id}`,
          })
          await this.peer.sc_send('tracoracle-activity', JSON.stringify({
            type:      'winnings_claimed',
            market_id: args.market_id,
            winner:    signer,
            amount:    result.payout,
          }))
        }
        return result
      }

      // ── READ OPS (no state change, no tx fee) ──────────────────────────────

      case 'market_list':
        return this.contract.market_list(args)

      case 'market_get':
        return this.contract.get_market(args.market_id)

      case 'my_stakes':
        return this.contract.my_stakes({ address: signer })

      default:
        throw new Error(`Unknown op: ${op}`)
    }
  }
}
