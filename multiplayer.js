// ─────────────────────────────────────────────────────────────
// multiplayer.js — co-op sync via PeerJS WebRTC
//
// TO CHANGE RELAY SERVER: replace the empty options object {}
// in _initAsHost() and _initAsClient() with:
//   { host: 'your-server.com', port: 9000, path: '/m1d1' }
// Free public relay: default (empty {}) uses 0.peerjs.com
// Self-host option: https://github.com/peers/peerjs-server
// ─────────────────────────────────────────────────────────────

class MultiplayerSystem {
  constructor() {
    this.state    = 'solo'; // 'solo' | 'connecting' | 'host' | 'client'
    this.peer     = null;
    this.conn     = null;
    this._handlers    = {};
    this._paramQueue  = {};
    this._rafPending  = false;
    this._joinUrl     = null;
    this._registryWired = false;
  }

  init() {
    const joinId = new URLSearchParams(location.search).get('join');
    if (joinId) this._initAsClient(joinId);
    else        this._initAsHost();
  }

  _initAsHost() {
    this.state = 'connecting';
    // TO CHANGE RELAY: replace {} with { host: 'your-host', port: 9000, path: '/myapp' }
    this.peer = new Peer({});
    this.peer.on('open', id => {
      this.state    = 'host';
      this._joinUrl = `${location.origin}${location.pathname}?join=${id}`;
      this._emit('state-change', this.state);
    });
    this.peer.on('connection', conn => {
      this.conn = conn;
      this._setupConn(conn);
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch(e) {} });
    this.peer.on('error', err => { console.warn('PeerJS:', err); this._emit('error', err); });
  }

  _initAsClient(hostId) {
    this.state = 'connecting';
    this._emit('state-change', this.state);
    // TO CHANGE RELAY: replace {} with { host: 'your-host', port: 9000, path: '/myapp' }
    this.peer = new Peer({});
    this.peer.on('open', () => {
      this.conn = this.peer.connect(hostId, { reliable: true });
      this._setupConn(this.conn);
    });
    this.peer.on('error', err => { console.warn('PeerJS:', err); this._emit('error', err); });
  }

  _setupConn(conn) {
    conn.on('open', () => {
      if (this.state === 'connecting') this.state = this._joinUrl ? 'host' : 'client';
      this._emit('state-change', this.state);
      this._emit('connected');
    });
    conn.on('data', msg => this._emit(msg.type, msg));
    conn.on('close', () => {
      this.state = 'solo';
      this._emit('state-change', this.state);
      this._emit('disconnected');
    });
    conn.on('error', err => { console.warn('PeerJS conn:', err); this._emit('error', err); });
  }

  on(type, handler) {
    (this._handlers[type] ??= []).push(handler);
    return this;
  }

  send(type, payload = {}) {
    if (this.conn?.open) this.conn.send({ type, ...payload });
  }

  // Throttled param send — coalesces rapid knob sweeps, drains once per rAF
  sendParam(id, param, value) {
    this._paramQueue[`${id}:${param}`] = { id, param, value };
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      const q = this._paramQueue; this._paramQueue = {};
      for (const { id, param, value } of Object.values(q))
        this.send('PARAM_CHANGE', { id, param, value });
    });
  }

  get isHost()      { return this.state === 'host'; }
  get isClient()    { return this.state === 'client'; }
  get isConnected() { return this.state === 'host' || this.state === 'client'; }

  getJoinUrl() { return this._joinUrl; }

  // Serialize full registry state for HELLO handshake
  snapshotRegistry(registry) {
    return {
      modules:  [...registry.modules.values()].map(m => ({ id: m.id, type: m.type, params: { ...m.params } })),
      patches:  registry.patches.map(p => ({ ...p })),
      counters: { ...registry._counters },
    };
  }

  // Replay a host snapshot into a fresh registry — bypasses addModule to preserve exact IDs
  replaySnapshot(registry, snap) {
    // Clear any locally-loaded modules (from client's own save) except audio-out-0
    for (const id of [...registry.modules.keys()]) {
      if (id !== 'audio-out-0') registry.removeModule(id);
    }
    // Sync counters so future addModule calls stay consistent
    Object.assign(registry._counters, snap.counters);
    // Insert host modules, skipping any that already exist (audio-out-0)
    for (const { id, type, params } of snap.modules) {
      if (registry.modules.has(id)) continue;
      registry.modules.set(id, { id, type, params: { ...params } });
      registry.dispatchEvent(new CustomEvent('module-added', { detail: { id, type, params } }));
    }
    // Apply patches
    registry.patches = snap.patches.map(p => ({ ...p }));
    registry.dispatchEvent(new CustomEvent('patch-changed', { detail: { patches: registry.patches } }));
  }

  _emit(type, data) {
    this._handlers[type]?.forEach(h => h(data));
  }
}
