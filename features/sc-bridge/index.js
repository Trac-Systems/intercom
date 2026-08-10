import Feature from 'trac-peer/src/artifacts/feature.js';
import { TerminalHandlers } from 'trac-peer/src/terminal/handlers.js';
import b4a from 'b4a';
import ws from 'bare-ws';

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return String(value);
  }
};

const parseJsonOrBase64 = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_e) {
      return null;
    }
  }
  try {
    const text = b4a.toString(b4a.from(trimmed, 'base64'), 'utf8');
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
};

const parseFilter = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split('|')
    .map((group) =>
      group
        .trim()
        .split(/[+,\s]+/)
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => word.toLowerCase())
    )
    .filter((group) => group.length > 0);
};

const matchesFilter = (filter, text) => {
  if (!filter || filter.length === 0) return true;
  const haystack = text.toLowerCase();
  return filter.some((group) => group.every((word) => haystack.includes(word)));
};

class ScBridge extends Feature {
  constructor(peer, config = {}) {
    super(peer, config);
    this.key = 'sc-bridge';
    this.sidechannel = null;
    this.server = null;
    this.started = false;
    this.clients = new Set();
    this.cliHandlers = new TerminalHandlers(peer);
    this.cliQueue = Promise.resolve();

    this.host = typeof config.host === 'string' ? config.host : '127.0.0.1';
    this.port = Number.isSafeInteger(config.port) ? config.port : 49222;
    this.token = typeof config.token === 'string' && config.token.length > 0 ? config.token : null;
    this.requireAuth = config.requireAuth !== false;
    this.cliEnabled = config.cliEnabled === true;
    this.debug = config.debug === true;

    this.defaultFilterRaw = typeof config.filter === 'string' ? config.filter : '';
    this.defaultFilter = parseFilter(this.defaultFilterRaw);
    this.filterChannels = Array.isArray(config.filterChannels)
      ? new Set(config.filterChannels.map((c) => String(c)))
      : null;
    this.info = config.info && typeof config.info === 'object' ? config.info : null;
  }

  attachSidechannel(sidechannel) {
    this.sidechannel = sidechannel;
  }

  _broadcastToClient(client, payload) {
    try {
      const data = JSON.stringify(payload);
      client.socket.write(data);
    } catch (_e) {}
  }

  _shouldEmit(client, channel, messageText) {
    if (client.channels && client.channels.size > 0 && !client.channels.has(channel)) {
      return false;
    }
    const filterApplies = this.filterChannels ? this.filterChannels.has(channel) : true;
    if (!filterApplies) return true;
    return matchesFilter(client.filter, messageText);
  }

  handleSidechannelMessage(channel, payload, _connection) {
    const messageText = normalizeText(payload?.message ?? payload);
    const event = {
      type: 'sidechannel_message',
      channel,
      id: payload?.id ?? null,
      from: payload?.from ?? null,
      origin: payload?.origin ?? null,
      // Message signatures are not secret; exposing them helps devs verify authenticity/debug drops.
      sig: payload?.sig ?? payload?.signature ?? null,
      relayedBy: payload?.relayedBy ?? null,
      ttl: payload?.ttl ?? null,
      ts: payload?.ts ?? Date.now(),
      message: payload?.message ?? payload,
    };
    if (this.debug) {
      console.log(`[sc-bridge] recv ${channel}:`, messageText);
    }
    if (this.debug) {
      console.log(`[sc-bridge] clients ${this.clients.size}`);
    }
    for (const client of this.clients) {
      if (!client.ready) continue;
      if (!this._shouldEmit(client, channel, messageText)) {
        if (this.debug) console.log('[sc-bridge] filtered');
        continue;
      }
      if (this.debug) console.log('[sc-bridge] emit');
      this._broadcastToClient(client, event);
    }
  }

  _sendError(client, error) {
    this._broadcastToClient(client, { type: 'error', error });
  }

  _handleClientMessage(client, message) {
    if (!message || typeof message !== 'object') {
      this._sendError(client, 'Invalid message.');
      return;
    }
    const reqId = Number.isInteger(message.id) ? message.id : null;
    const reply = (payload) => {
      if (reqId !== null) {
        this._broadcastToClient(client, { id: reqId, ...payload });
      } else {
        this._broadcastToClient(client, payload);
      }
    };
    const sendError = (error) => reply({ type: 'error', error });

    if (message.type === 'auth') {
      if (!this.token) {
        sendError('Auth not enabled.');
        return;
      }
      if (message.token === this.token) {
        client.authed = true;
        client.ready = true;
        reply({ type: 'auth_ok' });
        return;
      }
      sendError('Unauthorized.');
      return;
    }

    if (this.requireAuth && !client.authed) {
      sendError('Unauthorized.');
      return;
    }

    switch (message.type) {
      case 'cli': {
        if (!this.cliEnabled) {
          sendError('CLI over WS is disabled.');
          return;
        }
        const command = typeof message.command === 'string' ? message.command.trim() : '';
        if (!command) {
          sendError('Missing command.');
          return;
        }
        this._enqueueCli(command)
          .then((result) => {
            reply({
              type: 'cli_result',
              command,
              ok: result.ok,
              output: result.output,
              error: result.error,
              result: result.result,
            });
          })
          .catch((err) => {
            reply({
              type: 'cli_result',
              command,
              ok: false,
              output: [],
              error: err?.message ?? String(err),
              result: null,
            });
          });
        return;
      }
      case 'ping':
        reply({ type: 'pong', ts: Date.now() });
        return;
      case 'set_filter': {
        client.filter = parseFilter(message.filter || '');
        reply({ type: 'filter_set', filter: message.filter || '' });
        return;
      }
      case 'clear_filter': {
        client.filter = [];
        reply({ type: 'filter_set', filter: '' });
        return;
      }
      case 'subscribe': {
        const channels = Array.isArray(message.channels)
          ? message.channels
          : message.channel
            ? [message.channel]
            : [];
        if (!client.channels) client.channels = new Set();
        for (const ch of channels) client.channels.add(String(ch));
        reply({ type: 'subscribed', channels: Array.from(client.channels) });
        return;
      }
      case 'unsubscribe': {
        const channels = Array.isArray(message.channels)
          ? message.channels
          : message.channel
            ? [message.channel]
            : [];
        if (!client.channels) client.channels = new Set();
        for (const ch of channels) client.channels.delete(String(ch));
        reply({ type: 'subscribed', channels: Array.from(client.channels) });
        return;
      }
      case 'send': {
        if (!this.sidechannel) {
          sendError('Sidechannel not ready.');
          return;
        }
        const channel = String(message.channel || '').trim();
        if (!channel) {
          sendError('Missing channel.');
          return;
        }
        const payload = message.message;
        const invite = parseJsonOrBase64(message.invite);
        const welcome = parseJsonOrBase64(message.welcome);
        if (message.invite && !invite) {
          sendError('Invalid invite (expected JSON or base64).');
          return;
        }
        if (message.welcome && !welcome) {
          sendError('Invalid welcome (expected JSON or base64).');
          return;
        }
        let invitePayload = invite;
        if (invitePayload && welcome && !invitePayload.welcome) {
          invitePayload = { ...invitePayload, welcome };
        }
        if (welcome && !invitePayload) {
          this.sidechannel.acceptInvite(channel, null, welcome);
        }
        const ok = this.sidechannel.broadcast(
          channel,
          payload,
          invitePayload ? { invite: invitePayload } : undefined
        );
        if (!ok) {
          sendError('Send denied (invite required or invalid).');
          return;
        }
        reply({ type: 'sent', channel });
        return;
      }
      case 'join': {
        if (!this.sidechannel) {
          sendError('Sidechannel not ready.');
          return;
        }
        const channel = String(message.channel || '').trim();
        if (!channel) {
          sendError('Missing channel.');
          return;
        }
        const invite = parseJsonOrBase64(message.invite);
        const welcome = parseJsonOrBase64(message.welcome);
        if (message.invite && !invite) {
          sendError('Invalid invite (expected JSON or base64).');
          return;
        }
        if (message.welcome && !welcome) {
          sendError('Invalid welcome (expected JSON or base64).');
          return;
        }
        if (invite || welcome) {
          this.sidechannel.acceptInvite(channel, invite, welcome);
        }
        // `addChannel` resolves only once the topic is genuinely announced on
        // the swarm, so the reply is deferred for as long as that takes (a join
        // arriving while the sidechannel is still bootstrapping waits for
        // start() to announce it). `announced: true` states that contract
        // explicitly: a `joined` reply always means discoverable, never merely
        // registered. Clients that give up first see their own timeout rather
        // than a premature success.
        this.sidechannel
          .addChannel(channel)
          .then((ok) => {
            if (!ok) {
              sendError('Join denied (invite required or invalid).');
              return;
            }
            reply({ type: 'joined', channel, announced: true });
          })
          .catch((err) => {
            sendError(err?.message ? `Join failed: ${err.message}` : 'Join failed.');
          });
        return;
      }
      case 'leave': {
        if (!this.sidechannel) {
          sendError('Sidechannel not ready.');
          return;
        }
        const channel = String(message.channel || '').trim();
        if (!channel) {
          sendError('Missing channel.');
          return;
        }
        this.sidechannel
          .removeChannel(channel)
          .then((ok) => {
            // Leaving a non-joined channel is treated as a no-op.
            if (client.channels) client.channels.delete(channel);
            reply({ type: 'left', channel, ok });
          })
          .catch((err) => {
            sendError(err?.message ? `Leave failed: ${err.message}` : 'Leave failed.');
          });
        return;
      }
      case 'open': {
        if (!this.sidechannel) {
          sendError('Sidechannel not ready.');
          return;
        }
        const channel = String(message.channel || '').trim();
        if (!channel) {
          sendError('Missing channel.');
          return;
        }
        const via = message.via ? String(message.via) : null;
        const invite = parseJsonOrBase64(message.invite);
        const welcome = parseJsonOrBase64(message.welcome);
        if (message.invite && !invite) {
          sendError('Invalid invite (expected JSON or base64).');
          return;
        }
        if (message.welcome && !welcome) {
          sendError('Invalid welcome (expected JSON or base64).');
          return;
        }
        const ok = this.sidechannel.requestOpen(channel, via, invite, welcome);
        if (!ok) {
          sendError('Open request denied (invalid input or missing invite/welcome).');
          return;
        }
        reply({ type: 'open_requested', channel, via: via || null });
        return;
      }
      case 'stats': {
        if (!this.sidechannel) {
          sendError('Sidechannel not ready.');
          return;
        }
        const channels = Array.from(this.sidechannel.channels.keys());
        const connectionCount = this.sidechannel.connections.size;
        reply({
          type: 'stats',
          channels,
          connectionCount,
          sidechannelStarted: this.sidechannel.started === true,
        });
        return;
      }
      case 'info': {
        if (!this.info) {
          sendError('Info not available.');
          return;
        }
        reply({ type: 'info', info: this.info });
        return;
      }
      default:
        sendError(`Unknown type: ${message.type}`);
    }
  }

  _handleSocketData(client, data) {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (b4a.isBuffer(data)) text = b4a.toString(data, 'utf8');
    else text = String(data);

    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch (_e) {
      this._sendError(client, 'Invalid JSON.');
      return;
    }
    this._handleClientMessage(client, msg);
  }

  _formatLogArgs(args) {
    return args
      .map((value) => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch (_e) {
          return String(value);
        }
      })
      .join(' ');
  }

  async _withConsoleCapture(fn) {
    const output = [];
    const original = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };
    console.log = (...args) => {
      output.push(this._formatLogArgs(args));
      original.log(...args);
    };
    console.error = (...args) => {
      output.push(this._formatLogArgs(args));
      original.error(...args);
    };
    console.warn = (...args) => {
      output.push(this._formatLogArgs(args));
      original.warn(...args);
    };
    try {
      const result = await fn();
      return { ok: true, output, result, error: null };
    } catch (err) {
      return { ok: false, output, result: null, error: err?.message ?? String(err) };
    } finally {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
    }
  }

  _enqueueCli(command) {
    const run = async () => this._withConsoleCapture(() => this._dispatchCli(command));
    this.cliQueue = this.cliQueue.then(run, run);
    return this.cliQueue;
  }

  async _dispatchCli(input) {
    const handlers = [
      { rule: (line) => line === '/stats', handler: (line) => this.cliHandlers.verifyDag(line) },
      { rule: (line) => line === '/help', handler: () => this._printHelpToConsole() },
      { rule: (line) => line === '/exit', handler: () => this.cliHandlers.exit({}) },
      { rule: (line) => line === '/get_keys', handler: () => this.cliHandlers.getKeys() },
      { rule: (line) => line.startsWith('/tx'), handler: (line) => this.cliHandlers.tx(line) },
      { rule: (line) => line.startsWith('/add_indexer'), handler: (line) => this.cliHandlers.addIndexer(line) },
      { rule: (line) => line.startsWith('/add_writer'), handler: (line) => this.cliHandlers.addWriter(line) },
      { rule: (line) => line.startsWith('/remove_writer'), handler: (line) => this.cliHandlers.removeWriter(line) },
      { rule: (line) => line.startsWith('/remove_indexer'), handler: (line) => this.cliHandlers.removeIndexer(line) },
      { rule: (line) => line.startsWith('/add_admin'), handler: (line) => this.cliHandlers.addAdmin(line) },
      { rule: (line) => line.startsWith('/update_admin'), handler: (line) => this.cliHandlers.updateAdmin(line) },
      { rule: (line) => line.startsWith('/enable_transactions'), handler: (line) => this.cliHandlers.enableTransactions(line) },
      { rule: (line) => line.startsWith('/set_auto_add_writers'), handler: (line) => this.cliHandlers.setAutoAddWriters(line) },
      { rule: (line) => line.startsWith('/set_chat_status'), handler: (line) => this.cliHandlers.setChatStatus(line) },
      { rule: (line) => line.startsWith('/post'), handler: (line) => this.cliHandlers.postMessage(line) },
      { rule: (line) => line.startsWith('/set_nick'), handler: (line) => this.cliHandlers.setNick(line) },
      { rule: (line) => line.startsWith('/mute_status'), handler: (line) => this.cliHandlers.muteStatus(line) },
      { rule: (line) => line.startsWith('/pin_message'), handler: (line) => this.cliHandlers.pinMessage(line) },
      { rule: (line) => line.startsWith('/unpin_message'), handler: (line) => this.cliHandlers.unpinMessage(line) },
      { rule: (line) => line.startsWith('/set_mod'), handler: (line) => this.cliHandlers.setMod(line) },
      { rule: (line) => line.startsWith('/delete_message'), handler: (line) => this.cliHandlers.deleteMessage(line) },
      { rule: (line) => line.startsWith('/enable_whitelist'), handler: (line) => this.cliHandlers.enableWhitelist(line) },
      { rule: (line) => line.startsWith('/set_whitelist_status'), handler: (line) => this.cliHandlers.setWhitelistStatus(line) },
      { rule: (line) => line.startsWith('/deploy_subnet'), handler: (line) => this.cliHandlers.deploySubnet(line) },
      { rule: () => true, handler: (line) => this.peer?.protocol?.instance?.customCommand(line) },
    ];

    for (const { rule, handler } of handlers) {
      if (!rule(input)) continue;
      return handler(input);
    }
    return null;
  }

  _printHelpToConsole() {
    // Mirror Terminal.printHelp content without needing readline.
    console.log('Node started. Available commands:');
    console.log(' ');
    console.log('- Setup Commands:');
    console.log('- /add_admin | Works only once and only on the bootstrap node. Enter a peer public key (hex) to assign admin rights: \'/add_admin --address "<hex>"\'.');
    console.log('- /update_admin | Existing admins may transfer admin ownership. Enter "null" as address to waive admin rights for this peer entirely: \'/update_admin --address "<address>"\'.');
    console.log('- /add_indexer | Only admin. Enter a peer writer key to get included as indexer for this network: \'/add_indexer --key "<key>"\'.');
    console.log('- /add_writer | Only admin. Enter a peer writer key to get included as writer for this network: \'/add_writer --key "<key>"\'.');
    console.log('- /remove_writer | Only admin. Enter a peer writer key to get removed as writer or indexer for this network: \'/remove_writer --key "<key>"\'.');
    console.log('- /remove_indexer | Only admin. Alias of /remove_writer (removes indexer as well): \'/remove_indexer --key "<key>"\'.');
    console.log('- /set_auto_add_writers | Only admin. Allow any peer to join as writer automatically: \'/set_auto_add_writers --enabled 1\'');
    console.log('- /enable_transactions | Enable transactions.');
    console.log(' ');
    console.log('- Chat Commands:');
    console.log('- /set_chat_status | Only admin. Enable/disable the built-in chat system: \'/set_chat_status --enabled 1\'. The chat system is disabled by default.');
    console.log('- /post | Post a message: \'/post --message "Hello"\'. Chat must be enabled. Optionally use \'--reply_to <message id>\' to respond to a desired message.');
    console.log('- /set_nick | Change your nickname like this \'/set_nick --nick "Peter"\'. Chat must be enabled. Can be edited by admin and mods using the optional --user <address> flag.');
    console.log('- /mute_status | Only admin and mods. Mute or unmute a user by their address: \'/mute_status --user "<address>" --muted 1\'.');
    console.log('- /set_mod | Only admin. Set a user as mod: \'/set_mod --user "<address>" --mod 1\'.');
    console.log('- /delete_message | Delete a message: \'/delete_message --id 1\'. Chat must be enabled.');
    console.log('- /pin_message | Set the pin status of a message: \'/pin_message --id 1 --pin 1\'. Chat must be enabled.');
    console.log('- /unpin_message | Unpin a message by its pin id: \'/unpin_message --pin_id 1\'. Chat must be enabled.');
    console.log('- /enable_whitelist | Only admin. Enable/disable chat whitelists: \'/enable_whitelist --enabled 1\'.');
    console.log('- /set_whitelist_status | Only admin. Add/remove users to/from the chat whitelist: \'/set_whitelist_status --user "<address>" --status 1\'.');
    console.log(' ');
    console.log('- System Commands:');
    console.log('- /tx | Perform a contract transaction. The command flag contains contract commands (format is protocol dependent): \'/tx --command "<string>"\'. To simulate a tx, additionally use \'--sim 1\'.');
    console.log('- /deploy_subnet | Register this subnet in the MSB (required before TX settlement): \'/deploy_subnet\'.');
    console.log('- /stats | check system properties such as writer key, DAG, etc.');
    console.log('- /get_keys | prints your public and private keys. Be careful and never share your private key!');
    console.log('- /exit | Exit the program');
    console.log('- /help | This help text');
    if (this.peer?.protocol?.instance?.printOptions) {
      this.peer.protocol.instance.printOptions();
    }
  }

  start() {
    if (this.started) return;
    if (this.requireAuth && !this.token) {
      throw new Error('SC-Bridge requires --sc-bridge-token when auth is required.');
    }
    this.started = true;
    this.server = new ws.Server({ host: this.host, port: this.port }, (socket) => {
      const client = {
        socket,
        ready: !this.requireAuth,
        authed: !this.requireAuth,
        filter: this.defaultFilter,
        channels: null,
      };
      this.clients.add(client);

      const hello = {
        type: 'hello',
        peer: this.peer?.wallet?.publicKey ?? null,
        address: this.peer?.wallet?.address ?? null,
        entryChannel: this.sidechannel?.entryChannel ?? null,
        filter: this.defaultFilterRaw || '',
        requiresAuth: this.requireAuth,
      };
      this._broadcastToClient(client, hello);

      socket.on('data', (data) => this._handleSocketData(client, data));
      const cleanup = () => this.clients.delete(client);
      socket.on('close', cleanup);
      socket.on('end', cleanup);
      socket.on('error', cleanup);
    });
  }

  stop() {
    if (!this.server) return;
    try {
      this.server.close();
    } catch (_e) {}
    this.server = null;
    this.started = false;
    this.clients.clear();
  }
}

export default ScBridge;
