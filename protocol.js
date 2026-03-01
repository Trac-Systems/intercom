import { Protocol } from "trac-peer";

/**
 * Fractional Trading Cards Protocol (MVP)
 *
 * Purpose:
 * - Map `/tx --command "<string>"` into contract messages: { type, value }
 *
 * Supported commands:
 * - create_asset <assetId> <totalShares> [initialOwner]
 * - transfer_shares <assetId> <to> <shares>
 * - read_asset <assetId>
 * - read_holders <assetId>
 *
 * Also supports JSON form:
 * /tx --command '{"op":"create_asset","assetId":"...","totalShares":10000,"initialOwner":"..."}'
 */

class FractionalProtocol extends Protocol {
  constructor(peer, base, options = {}) {
    super(peer, base, options);
  }

  async extendApi() {
    // Keep empty for now (we'll add convenience helpers later).
  }

  _safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_e) {
      return null;
    }
  }

  mapTxCommand(command) {
    const raw = String(command ?? "").trim();
    if (!raw) return null;

    // 1) JSON form
    if (raw.startsWith("{")) {
      const json = this._safeJsonParse(raw);
      if (!json || !json.op) return null;

      if (json.op === "create_asset") {
        return {
          type: "create_asset",
          value: {
            assetId: json.assetId,
            totalShares: json.totalShares,
            initialOwner: json.initialOwner
          }
        };
      }

      if (json.op === "transfer_shares") {
        return {
          type: "transfer_shares",
          value: {
            assetId: json.assetId,
            to: json.to,
            shares: json.shares
          }
        };
      }

      if (json.op === "read_asset") {
        return { type: "read_asset", value: { assetId: json.assetId } };
      }

      if (json.op === "read_holders") {
        return { type: "read_holders", value: { assetId: json.assetId } };
      }

      return null;
    }

    // 2) Plain string form
    const parts = raw.split(/\s+/);
    const op = parts[0];

    if (op === "create_asset") {
      // create_asset <assetId> <totalShares> [initialOwner]
      const assetId = parts[1];
      const totalShares = parts[2];
      const initialOwner = parts[3]; // optional
      return {
        type: "create_asset",
        value: { assetId, totalShares: Number(totalShares), initialOwner }
      };
    }

    if (op === "transfer_shares") {
      // transfer_shares <assetId> <to> <shares>
      const assetId = parts[1];
      const to = parts[2];
      const shares = parts[3];
      return {
        type: "transfer_shares",
        value: { assetId, to, shares: Number(shares) }
      };
    }

    if (op === "read_asset") {
      const assetId = parts[1];
      return { type: "read_asset", value: { assetId } };
    }

    if (op === "read_holders") {
      const assetId = parts[1];
      return { type: "read_holders", value: { assetId } };
    }

    return null;
  }

  async printOptions() {
    console.log(" ");
    console.log("- Fractional Ownership Commands (Contract TX):");
    console.log('- /tx --command "create_asset <assetId> <totalShares> [initialOwner]"');
    console.log('- /tx --command "transfer_shares <assetId> <to> <shares>"');
    console.log('- /tx --command "read_asset <assetId>"');
    console.log('- /tx --command "read_holders <assetId>"');
    console.log(" ");
    console.log("- JSON Form:");
    console.log(`- /tx --command '{"op":"create_asset","assetId":"tc:...","totalShares":10000,"initialOwner":"trac1..."}'`);
  }
}

export default FractionalProtocol;
