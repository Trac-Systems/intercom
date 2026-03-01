/**
 * Fractional Trading Card Ownership Contract (MVP)
 *
 * Deterministic replicated state:
 * - assets[assetId] = { assetId, totalShares, createdAt }
 * - holders[assetId][address] = shares
 *
 * Commands:
 * - create_asset
 * - transfer_shares
 * - read_asset
 * - read_holders
 *
 * Notes:
 * - Minimal prototype. No settlement.
 * - Compatible with Protocol.mapTxCommand() which provides { type, value }.
 */

export default function contract (state = {}, message = {}) {
  state.assets ??= {};
  state.holders ??= {};

  const { type, from } = message;

  // IMPORTANT: tx protocol may deliver payload as message.value
  const args = message.args ?? message.value ?? {};

  const asInt = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error("INVALID_INT");
    return n;
  };

  const ensureAsset = (assetId) => {
    const a = state.assets[assetId];
    if (!a) throw new Error("ASSET_NOT_FOUND");
    state.holders[assetId] ??= {};
    return a;
  };

  if (type === "create_asset") {
    const assetId = String(args.assetId || "").trim();
    if (!assetId) throw new Error("ASSET_ID_REQUIRED");

    const totalShares = asInt(args.totalShares);
    if (totalShares <= 0) throw new Error("TOTAL_SHARES_INVALID");

    const initialOwner = String(args.initialOwner || from || "").trim();
    if (!initialOwner) throw new Error("INITIAL_OWNER_REQUIRED");

    if (state.assets[assetId]) throw new Error("ASSET_ALREADY_EXISTS");

    state.assets[assetId] = {
      assetId,
      totalShares,
      createdAt: Date.now()
    };

    state.holders[assetId] = {
      [initialOwner]: totalShares
    };

    return state;
  }

  if (type === "transfer_shares") {
    const assetId = String(args.assetId || "").trim();
    const to = String(args.to || "").trim();
    const shares = asInt(args.shares);

    if (!assetId) throw new Error("ASSET_ID_REQUIRED");
    if (!to) throw new Error("TO_REQUIRED");
    if (shares <= 0) throw new Error("SHARES_INVALID");

    ensureAsset(assetId);

    const fromAddr = String(from || "").trim();
    if (!fromAddr) throw new Error("FROM_REQUIRED");

    const holders = (state.holders[assetId] ??= {});
    const fromBal = asInt(holders[fromAddr] || 0);
    if (fromBal < shares) throw new Error("INSUFFICIENT_SHARES");

    holders[fromAddr] = fromBal - shares;
    holders[to] = asInt(holders[to] || 0) + shares;

    if (holders[fromAddr] === 0) delete holders[fromAddr];
    return state;
  }

  if (type === "read_asset") {
    const assetId = String(args.assetId || "").trim();
    if (!assetId) throw new Error("ASSET_ID_REQUIRED");
    const asset = state.assets[assetId] || null;
    return { asset };
  }

  if (type === "read_holders") {
    const assetId = String(args.assetId || "").trim();
    if (!assetId) throw new Error("ASSET_ID_REQUIRED");
    const holders = state.holders[assetId] || {};
    return { holders };
  }

  return state;
}
