const el = (id) => document.getElementById(id);

const state = {
  ws: null,
  authed: false,
  nextId: 1,
  pending: new Map(),
};

const timeoutByType = {
  expense_persist: 65_000,
  expense_restore: 30_000,
  expense_export: 20_000,
  expense_balance: 20_000,
};

const logEl = el('log');
const statusEl = el('status');
const joinStateEl = el('joinState');
const subStateEl = el('subState');

const log = (message, kind = 'info') => {
  let safeMessage = String(message ?? '');
  if (safeMessage.length > 900) {
    safeMessage = `${safeMessage.slice(0, 900)} ...[truncated]`;
  }
  const line = document.createElement('div');
  const ts = new Date().toISOString().slice(11, 19);
  line.textContent = `[${ts}] ${kind.toUpperCase()} ${safeMessage}`;
  if (kind === 'error') line.style.color = '#dc2626';
  if (kind === 'ok') line.style.color = '#0f766e';
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const setMiniState = (target, text, kind = '') => {
  if (!target) return;
  target.textContent = text;
  target.classList.remove('ok', 'pending', 'error');
  if (kind) target.classList.add(kind);
};

const sendRaw = (payload) => {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket is not connected.');
  }
  state.ws.send(JSON.stringify(payload));
};

const request = (type, payload = {}, options = {}) =>
  new Promise((resolve, reject) => {
    const id = state.nextId++;
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : timeoutByType[type] || 12_000;
    const timer = setTimeout(() => {
      const p = state.pending.get(id);
      if (!p) return;
      state.pending.delete(id);
      reject(new Error(`Request timeout: ${type}`));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, type, timer });
    try {
      sendRaw({ id, type, ...payload });
    } catch (err) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(err);
    }
  });

const withButtonBusy = async (buttonId, busyLabel, task) => {
  const btn = el(buttonId);
  if (!btn) return task();
  if (btn.dataset.busy === '1') return;
  const prevText = btn.textContent;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    return await task();
  } finally {
    btn.dataset.busy = '0';
    btn.disabled = false;
    btn.textContent = prevText;
  }
};

const channel = () => String(el('channel').value || '').trim();

const connect = () => {
  const wsUrl = String(el('wsUrl').value || '').trim();
  const token = String(el('token').value || '').trim();
  if (!wsUrl) {
    log('WS URL is required.', 'error');
    return;
  }
  if (!token) {
    log('SC-Bridge token is required.', 'error');
    return;
  }

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }
  state.ws = new WebSocket(wsUrl);
  setStatus('connecting...');
  setMiniState(joinStateEl, 'Join: not joined');
  setMiniState(subStateEl, 'Subscribe: inactive');

  state.ws.onopen = () => {
    setStatus('connected');
    log(`Connected: ${wsUrl}`, 'ok');
    sendRaw({ type: 'auth', token });
  };

  state.ws.onclose = () => {
    state.authed = false;
    setStatus('disconnected');
    setMiniState(joinStateEl, 'Join: disconnected');
    setMiniState(subStateEl, 'Subscribe: disconnected');
    log('Disconnected.', 'error');
  };

  state.ws.onerror = () => {
    setStatus('error');
    log('WebSocket error.', 'error');
  };

  state.ws.onmessage = (ev) => {
    let msg = null;
    try {
      msg = JSON.parse(ev.data);
    } catch (_e) {
      log(`Non-JSON message: ${String(ev.data)}`, 'error');
      return;
    }

    if (Number.isInteger(msg.id) && state.pending.has(msg.id)) {
      const p = state.pending.get(msg.id);
      state.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.type === 'error') p.reject(new Error(msg.error || 'Request failed.'));
      else p.resolve(msg);
      return;
    }

    if (msg.type === 'hello') {
      log(`Hello peer=${msg.peer || 'n/a'} requiresAuth=${String(msg.requiresAuth)}`);
      return;
    }
    if (msg.type === 'auth_ok') {
      state.authed = true;
      setStatus('authenticated');
      log('Authenticated.', 'ok');
      return;
    }
    if (msg.type === 'error') {
      log(msg.error || 'Unknown error', 'error');
      return;
    }
    if (msg.type === 'sidechannel_message') {
      const from = msg.from || 'unknown';
      const m = typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message);
      log(`[${msg.channel}] ${from}: ${m}`);
      return;
    }

    log(JSON.stringify(msg));
  };
};

const run = async (fn) => {
  try {
    await fn();
  } catch (err) {
    log(err?.message || String(err), 'error');
  }
};

const mustAuth = () => {
  if (!state.authed) throw new Error('Authenticate first (Connect).');
};

const parseAssistant = async () => {
  mustAuth();
  const input = String(el('assistantText').value || '').trim();
  if (!input) return;
  const c = channel();
  const lower = input.toLowerCase();

  if (lower.startsWith('balance')) {
    const res = await request('expense_balance', { channel: c });
    log(JSON.stringify(res.summary, null, 2), 'ok');
    return;
  }
    if (lower.startsWith('persist')) {
      log('Persisting snapshot... this can take 10-60s.');
      const res = await request('expense_persist', { channel: c }, { timeoutMs: 65_000 });
      log(`Persisted tx=${res.tx || 'n/a'}`, 'ok');
      return;
    }
    if (lower.startsWith('restore')) {
      log('Restoring snapshot from local node store...');
      const res = await request(
        'expense_restore',
        { channel: c, confirmed: false, replace: true },
        { timeoutMs: 30_000 }
      );
      log(`Restored added=${res.added} total=${res.total} source=${res.source || 'unknown'}`, 'ok');
      return;
    }
  if (lower.startsWith('export')) {
    const m = input.match(/export\s+(text|json|csv)/i);
    const format = m ? m[1].toLowerCase() : 'text';
    const res = await request('expense_export', { channel: c, format });
    log(res.data || JSON.stringify(res), 'ok');
    return;
  }
  if (lower.startsWith('send ')) {
    const text = input.slice(5).trim();
    const res = await request('send', { channel: c, message: text });
    log(JSON.stringify(res), 'ok');
    return;
  }
  if (lower.startsWith('add ')) {
    const amount = input.match(/\b(\d+(?:\.\d+)?)\b/);
    const payer = input.match(/add\s+([a-z0-9_-]+)/i);
    const split = input.match(/split\s+([a-z0-9_,-]+)/i);
    const note = input.match(/note\s+(.+)$/i);
    if (!amount || !payer || !split) {
      throw new Error('Use: add alice 30 split alice,bob note dinner');
    }
    const res = await request('expense_add', {
      channel: c,
      payer: payer[1],
      amount: amount[1],
      split: split[1],
      note: note ? note[1] : '',
    });
    log(JSON.stringify(res), 'ok');
    return;
  }

  throw new Error('Unknown prompt. Try: add/balance/persist/restore/export/send');
};

el('connectBtn').addEventListener('click', () => run(connect));
el('disconnectBtn').addEventListener('click', () => {
  if (state.ws) state.ws.close();
});

el('joinBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const ch = channel();
    setMiniState(joinStateEl, `Join: joining ${ch}...`, 'pending');
    try {
      const res = await request('join', { channel: ch });
      setMiniState(joinStateEl, `Join: joined ${res.channel || ch}`, 'ok');
      log(JSON.stringify(res), 'ok');
    } catch (err) {
      setMiniState(joinStateEl, `Join: failed ${ch}`, 'error');
      throw err;
    }
  })
);

el('subBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const ch = channel();
    setMiniState(subStateEl, `Subscribe: updating ${ch}...`, 'pending');
    try {
      const res = await request('subscribe', { channel: ch });
      const channels = Array.isArray(res.channels) ? res.channels : [];
      const label = channels.length > 0 ? channels.join(', ') : 'none';
      setMiniState(subStateEl, `Subscribe: ${label}`, 'ok');
      log(JSON.stringify(res), 'ok');
    } catch (err) {
      setMiniState(subStateEl, `Subscribe: failed ${ch}`, 'error');
      throw err;
    }
  })
);

el('sendChatBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const msg = String(el('chatText').value || '').trim();
    if (!msg) throw new Error('Message is empty.');
    const res = await request('send', { channel: channel(), message: msg });
    log(JSON.stringify(res), 'ok');
    el('chatText').value = '';
  })
);

el('addExpenseBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const res = await request('expense_add', {
      channel: channel(),
      payer: String(el('payer').value || '').trim(),
      amount: String(el('amount').value || '').trim(),
      split: String(el('split').value || '').trim(),
      note: String(el('note').value || '').trim(),
    });
    log(JSON.stringify(res), 'ok');
  })
);

el('balanceBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const res = await request('expense_balance', { channel: channel() });
    log(JSON.stringify(res.summary, null, 2), 'ok');
  })
);

el('exportBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const res = await request('expense_export', { channel: channel(), format: 'text' });
    log(res.data || JSON.stringify(res), 'ok');
  })
);

el('persistBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    await withButtonBusy('persistBtn', 'Persisting...', async () => {
      log('Persisting snapshot... this can take 10-60s.');
      const res = await request('expense_persist', { channel: channel() }, { timeoutMs: 65_000 });
      log(`Persisted tx=${res.tx || 'n/a'}`, 'ok');
    });
  })
);

el('restoreBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    await withButtonBusy('restoreBtn', 'Restoring...', async () => {
      log('Restoring snapshot from local node store...');
      const res = await request(
        'expense_restore',
        {
          channel: channel(),
          confirmed: false,
          replace: true,
        },
        { timeoutMs: 30_000 }
      );
      log(`Restored added=${res.added} total=${res.total} source=${res.source || 'unknown'}`, 'ok');
    });
  })
);

el('clearBtn').addEventListener('click', () =>
  run(async () => {
    mustAuth();
    const res = await request('expense_clear', { channel: channel() });
    log(JSON.stringify(res), 'ok');
  })
);

el('assistantBtn').addEventListener('click', () => run(parseAssistant));

setStatus('disconnected');
log('UI loaded. Connect to SC-Bridge to begin.');
