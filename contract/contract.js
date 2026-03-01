const STATE_KEY = 'fo_state_v1';

function asInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('INVALID_INT');
  return n;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export default class FractionalOwnershipContract {

  emptyPromise() { return Promise.resolve(); }

  isReservedKey() { return false; }

  async _getState(storage) {
    const row = await storage.get(STATE_KEY);
    if (!row || row.value == null) return { assets: {}, holders: {} };
    return clone(row.value);
  }

  async execute(op, storage) {

    if (op.type !== 'tx') return null;

    const dispatch = op.value.dispatch;

    const type = dispatch.type;
    const args = dispatch.value || {};

    const state = await this._getState(storage);

    if (type === 'create_asset') {

      const assetId = args.assetId;
      const totalShares = asInt(args.totalShares);

      const owner = op.value.ipk;

      state.assets[assetId] = {

        assetId,
        totalShares

      };

      state.holders[assetId] = {

        [owner]: totalShares

      };

      return {

        type: 'put',
        key: STATE_KEY,
        value: state

      };

    }

    if (type === 'transfer_shares') {

      const assetId = args.assetId;
      const to = args.to;
      const shares = asInt(args.shares);

      const from = op.value.ipk;

      const holders = state.holders[assetId];

      if (!holders) throw new Error('NO_ASSET');

      if (!holders[from]) throw new Error('NO_BALANCE');

      if (holders[from] < shares) throw new Error('INSUFFICIENT');

      holders[from] -= shares;

      holders[to] = (holders[to] || 0) + shares;

      return {

        type: 'put',
        key: STATE_KEY,
        value: state

      };

    }

    if (type === 'read_holders') {

      return state.holders;

    }

    if (type === 'read_asset') {

      return state.assets;

    }

    return null;

  }

}
