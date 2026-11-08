// Act Natural: the encrypted relay, for networks where phones can't link directly to the TV.
//
// Ported from mafia-online (haryp2309/mafia-online, client/src/net/: mqttPacket.ts,
// mqttCrypto.ts, mqttReliable.ts, mqttTransport.ts, ice.ts; see its docs/p2p-networking.md),
// turned into plain JS for this no-build page and re-namespaced (topics actn/v1/…, labels
// actn-…, its own HKDF salt), so its messages could never be mistaken for mafia-online's.
//
// How it works, in short:
//   - An MQTT broker (our own Mosquitto on nithun.no) forwards messages over wss://. It is
//     treated as an untrusted wire: it only sees random-looking topic names and AES-GCM
//     ciphertext, so a broken-into server still can't read or fake game messages.
//   - The TV makes a random 256-bit room secret. It reaches phones only inside the QR link's
//     #fragment (browsers never send that to any server). Topics and the handshake key come
//     from it, so knowing the 5-letter code isn't enough to find or join the relay.
//   - Each phone does an authenticated ephemeral ECDH handshake with the TV, giving a
//     forward-secret AES-256-GCM key per connection.
//   - Brokers only offer fire-and-forget (QoS 0), so a small layer adds sequence numbers,
//     acks, resends and ordering.
//   - Both ends look like a PeerJS DataConnection (connectionId, open, send, close, on), so
//     host.js and phone.js treat a relay link like a direct one.
(function () {
  'use strict'
  const root = typeof window !== 'undefined' ? window : globalThis
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Our own broker: Mosquitto on the server, reached through Nginx on port 443 at
  // play.nithun.no/act-natural/mqtt (server/mqtt/README.md). `npm run dev` has no proxy for it:
  // ?broker=ws://localhost:9001 uses another one, for testing.
  // (mafia-online uses three free public brokers; they throttled the game's 15 messages a
  // second to a few, with seconds of delay, so this game has its own.)
  function brokers () {
    if (!root.location) return []
    const override = new URLSearchParams(location.search).get('broker')
    if (override && /^wss?:\/\/[\w.:-]+(\/[\w./-]*)?$/.test(override)) return [override]
    const u = new URL('mqtt', location.href)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.search = u.hash = ''
    return [u.toString()]
  }
  const BROKERS = brokers()
  const TOPIC = 'actn/v1'
  const HKDF_SALT = encoder.encode('act-natural-nithun-mqtt-e2ee-v1')
  const HANDSHAKE_TTL_MS = 120000   // clock difference allowed between phone and TV for a handshake

  // ======================================================================================
  // MQTT 3.1.1 codec (CONNECT with Last Will, CONNACK, PUBLISH QoS 0, SUBSCRIBE, SUBACK,
  // PINGREQ/PINGRESP, DISCONNECT), so no MQTT library is needed.
  // ======================================================================================

  function encodeLength (len) {
    const out = []
    let x = len
    do {
      let b = x % 128
      x = Math.floor(x / 128)
      if (x > 0) b |= 128
      out.push(b)
    } while (x > 0)
    return out
  }

  function withLength (bytes) {
    const out = new Uint8Array(2 + bytes.length)
    out[0] = (bytes.length >> 8) & 0xff
    out[1] = bytes.length & 0xff
    out.set(bytes, 2)
    return out
  }
  const encodeString = s => withLength(encoder.encode(s))

  function concatBytes (...arrays) {
    const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
    let o = 0
    for (const a of arrays) { out.set(a, o); o += a.length }
    return out
  }

  function framePacket (header, body) {
    const rem = encodeLength(body.length)
    const out = new Uint8Array(1 + rem.length + body.length)
    out[0] = header
    out.set(rem, 1)
    out.set(body, 1 + rem.length)
    return out
  }

  function encodeConnect ({ clientId, keepAliveSec = 30, will }) {
    let flags = 0x02                  // clean session
    if (will) flags |= 0x04           // will flag (QoS 0, not retained)
    const head = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, flags, (keepAliveSec >> 8) & 0xff, keepAliveSec & 0xff])
    const parts = [head, encodeString(clientId)]
    if (will) parts.push(encodeString(will.topic), withLength(will.payload))
    return framePacket(0x10, concatBytes(...parts))
  }

  function encodeSubscribe (packetId, topics) {
    const parts = [new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])]
    for (const t of topics) parts.push(encodeString(t), new Uint8Array([0]))
    return framePacket(0x82, concatBytes(...parts))
  }

  function encodePublish (topic, payload) {
    return framePacket(0x30, concatBytes(encodeString(topic), typeof payload === 'string' ? encoder.encode(payload) : payload))
  }

  const encodePingReq = () => new Uint8Array([0xc0, 0x00])
  const encodeDisconnect = () => new Uint8Array([0xe0, 0x00])

  // Turns incoming WebSocket chunks into packets; a packet may arrive split over several chunks.
  class MqttStreamDecoder {
    constructor () { this.buf = new Uint8Array(0) }

    push (chunk) {
      this.buf = this.buf.length ? concatBytes(this.buf, chunk) : chunk
      const packets = []
      while (this.buf.length >= 2) {
        const header = this.buf[0]
        const type = header >> 4
        let mult = 1, rem = 0, idx = 1, complete = false
        while (idx < this.buf.length) {
          const b = this.buf[idx++]
          rem += (b & 127) * mult
          if ((b & 128) === 0) { complete = true; break }
          mult *= 128
          if (mult > 128 * 128 * 128) { this.buf = new Uint8Array(0); return packets }   // malformed
        }
        if (!complete) break
        const total = idx + rem
        if (this.buf.length < total) break
        const body = this.buf.subarray(idx, total)
        this.buf = this.buf.subarray(total)
        if (type === 2 && body.length >= 2) {
          packets.push({ type: 'connack', returnCode: body[1] })
        } else if (type === 3 && body.length >= 2) {
          const tl = (body[0] << 8) | body[1]
          if (2 + tl <= body.length) {
            const topic = decoder.decode(body.subarray(2, 2 + tl))
            const start = 2 + tl + (((header >> 1) & 3) > 0 ? 2 : 0)
            if (start <= body.length) packets.push({ type: 'publish', topic, payload: body.slice(start) })
          }
        } else if (type === 9 && body.length >= 2) {
          packets.push({ type: 'suback', packetId: (body[0] << 8) | body[1] })
        } else if (type === 13) {
          packets.push({ type: 'pingresp' })
        }
      }
      return packets
    }
  }

  // ======================================================================================
  // Crypto: room keys from the secret, the ECDH handshake, and sealed session frames.
  // ======================================================================================

  const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  function toBase64 (bytes) {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
  function fromBase64 (b64) {
    const s = atob(b64)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  const toBase64Url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  function fromBase64Url (text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
    return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  }
  const randomHex = (n = 12) => toHex(crypto.getRandomValues(new Uint8Array(n)))

  // A new random 256-bit room secret, URL-safe (43 characters).
  const newRoomSecret = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

  function isValidRoomSecret (text) {
    if (!text || !/^[A-Za-z0-9_-]{22,}$/.test(text)) return false
    try { return fromBase64Url(text).length >= 16 } catch (e) { return false }
  }

  // HKDF(secret, info = room code) → 128-bit topic hash + 256-bit handshake key. Mixing in the
  // code stops one secret opening two rooms.
  const roomKeysCache = new Map()
  function deriveRoomKeys (roomCode, secret) {
    const norm = roomCode.trim().toUpperCase()
    if (!isValidRoomSecret(secret)) return Promise.reject(new Error('Missing or invalid room secret.'))
    const cacheKey = norm + '|' + secret
    if (roomKeysCache.has(cacheKey)) return roomKeysCache.get(cacheKey)
    const p = (async () => {
      const base = await crypto.subtle.importKey('raw', fromBase64Url(secret), 'HKDF', false, ['deriveBits'])
      const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode('actn-room|' + norm) }, base, 384))
      const roomAuthKey = await crypto.subtle.importKey('raw', bits.subarray(16, 48), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      return { roomCode: norm, topicHash: toHex(bits.subarray(0, 16)), roomAuthKey }
    })()
    roomKeysCache.set(cacheKey, p)
    return p
  }

  async function generateEphemeralKeyPair () {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const raw = await crypto.subtle.exportKey('raw', kp.publicKey)
    return { privateKey: kp.privateKey, publicKeyB64: toBase64(new Uint8Array(raw)) }
  }

  async function deriveSessionKey (myPrivateKey, peerPubB64, roomCode, clientId, sessionId, clientNonce, hostNonce) {
    const peerPub = await crypto.subtle.importKey('raw', fromBase64(peerPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, myPrivateKey, 256)
    const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    const info = encoder.encode(`actn-session|${roomCode}|${clientId}|${sessionId}|${clientNonce}|${hostNonce}`)
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }

  // Handshake messages (syn, syn-ack, bye) are sealed with the room key; the type is bound into
  // the additional data, so a syn can't be replayed as a syn-ack or a bye.
  async function encryptHandshake (roomAuthKey, topicHash, payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(`actn-hs|${topicHash}|${payload.t}`) },
      roomAuthKey, encoder.encode(JSON.stringify(payload)))
    return JSON.stringify({ v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) })
  }

  async function decryptHandshake (roomAuthKey, topicHash, expectedType, raw) {
    try {
      const env = JSON.parse(raw)
      if (!env || env.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null
      const iv = fromBase64(env.iv)
      if (iv.length !== 12) return null
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(`actn-hs|${topicHash}|${expectedType}`) },
        roomAuthKey, fromBase64(env.ct))
      const parsed = JSON.parse(decoder.decode(pt))
      return parsed && parsed.t === expectedType ? parsed : null
    } catch (e) {
      return null
    }
  }

  // The TV remembers recent handshake nonces, and refuses old or repeated ones.
  class HandshakeReplayGuard {
    constructor () { this.seen = new Map() }
    checkAndRecord (syn, now = Date.now()) {
      if (Math.abs(now - syn.ts) > HANDSHAKE_TTL_MS) return false
      for (const [nonce, ts] of this.seen) if (now - ts > HANDSHAKE_TTL_MS * 2) this.seen.delete(nonce)
      if (this.seen.has(syn.clientNonce)) return false
      this.seen.set(syn.clientNonce, now)
      return true
    }
  }

  // One connection's sealed frames: { v:2, sid, ch: 'd' data | 'c' control, seq, iv, ct }.
  // Session id, direction, channel and seq are bound into the additional data, so a frame can't
  // be moved to another session, reflected back to its sender, or moved to another position.
  // Data frames carry the reliable layer's seq; control frames have their own rising counter.
  class EncryptedSession {
    constructor (sessionId, key, txDir, rxDir) {
      Object.assign(this, { sessionId, key, txDir, rxDir, ctrlTx: 0, ctrlRxHighest: 0 })
    }

    aad (dir, ch, seq) { return encoder.encode(`actn-frame|${this.sessionId}|${dir}|${ch}|${seq}`) }

    async seal (ch, seq, body) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.aad(this.txDir, ch, seq) }, this.key, encoder.encode(JSON.stringify(body)))
      return JSON.stringify({ v: 2, sid: this.sessionId, ch, seq, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) })
    }

    sealData (seq, data) { return this.seal('d', seq, data) }
    sealControl (frame) { return this.seal('c', ++this.ctrlTx, frame) }

    async open (raw) {
      try {
        const env = JSON.parse(raw)
        if (!env || env.v !== 2 || env.sid !== this.sessionId || (env.ch !== 'd' && env.ch !== 'c') ||
          !Number.isInteger(env.seq) || env.seq < 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null
        if (env.ch === 'c' && env.seq <= this.ctrlRxHighest) return null
        const iv = fromBase64(env.iv)
        if (iv.length !== 12) return null
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: this.aad(this.rxDir, env.ch, env.seq) }, this.key, fromBase64(env.ct))
        const body = JSON.parse(decoder.decode(pt))
        if (env.ch === 'd') return { ch: 'd', seq: env.seq, data: body }
        if (!body || typeof body.k !== 'string') return null
        // Move the counter only after the tag verified, and check again: decrypts can finish out of order.
        if (env.seq <= this.ctrlRxHighest) return null
        this.ctrlRxHighest = env.seq
        return { ch: 'c', frame: body }
      } catch (e) {
        return null
      }
    }
  }

  // ======================================================================================
  // Reliable, ordered delivery on top of fire-and-forget: sequence numbers, cumulative acks
  // batched over 25 ms, resends after 1.2 s, give up after 15 sends of one message.
  // ======================================================================================

  class ReliableLink {
    constructor (session, publish, handlers, opts = {}) {
      Object.assign(this, { session, publish, handlers })
      this.resendAfterMs = opts.resendAfterMs ?? 1200
      this.maxSends = opts.maxSends ?? 15
      this.window = opts.window ?? 256
      this.nextTx = 1
      this.unacked = new Map()
      this.nextRx = 1
      this.reorder = new Map()
      this.txChain = Promise.resolve()
      this.ackTimer = null
      this.closed = false
      this.resendTimer = setInterval(() => this.resendDue(), Math.max(50, Math.floor(this.resendAfterMs / 2)))
    }

    get pending () { return this.unacked.size }

    send (data) {
      if (this.closed) return
      const seq = this.nextTx++
      this.unacked.set(seq, { data, sentAt: Date.now(), sends: 1 })
      this.enqueue(() => this.session.sealData(seq, data))
    }

    control (frame) {
      if (!this.closed) this.enqueue(() => this.session.sealControl(frame))
    }

    // One raw frame from the broker. False if it wasn't a valid frame for this session.
    async receive (raw) {
      const opened = await this.session.open(raw)
      if (!opened || this.closed) return false
      if (opened.ch === 'c') {
        if (opened.frame.k === 'ack') { for (const seq of this.unacked.keys()) if (seq <= opened.frame.upTo) this.unacked.delete(seq) }
        else this.handlers.onControl(opened.frame)
        return true
      }
      const { seq, data } = opened
      if (seq < this.nextRx) { this.scheduleAck(); return true }   // seen already: our ack was probably lost
      if (seq >= this.nextRx + this.window) return true
      this.reorder.set(seq, data)
      while (this.reorder.has(this.nextRx)) {
        const next = this.reorder.get(this.nextRx)
        this.reorder.delete(this.nextRx)
        this.nextRx++
        this.handlers.onData(next)
      }
      this.scheduleAck()
      return true
    }

    close () {
      this.closed = true
      clearTimeout(this.ackTimer)
      clearInterval(this.resendTimer)
      this.ackTimer = this.resendTimer = null
      this.unacked.clear()
      this.reorder.clear()
    }

    // Sends one last control frame, then closes.
    async closeWith (frame) {
      if (this.closed) return
      this.control(frame)
      const done = this.txChain
      this.close()
      await done
    }

    // Sealing is async: a chain keeps frames leaving in the order they were queued.
    enqueue (seal) {
      this.txChain = this.txChain.then(async () => { this.publish(await seal()) }).catch(() => {})
    }

    scheduleAck () {
      if (this.ackTimer || this.closed) return
      this.ackTimer = setTimeout(() => { this.ackTimer = null; this.control({ k: 'ack', upTo: this.nextRx - 1 }) }, 25)
    }

    resendDue () {
      if (this.closed) return
      const now = Date.now()
      for (const [seq, e] of this.unacked) {
        if (now - e.sentAt < this.resendAfterMs) continue
        if (e.sends >= this.maxSends) { this.handlers.onBroken(); return }
        e.sends++
        e.sentAt = now
        this.enqueue(() => this.session.sealData(seq, e.data))
      }
    }
  }

  // ======================================================================================
  // Transport: broker sockets, the TV's relay "server", and the phone's relay connection.
  // ======================================================================================

  const defaultWsFactory = (url, protocols) => new WebSocket(url, protocols)

  // The bits of PeerJS's event API that host.js and phone.js use.
  class EventHub {
    constructor () { this.listeners = { open: [], data: [], close: [], error: [] } }
    on (event, cb) { if (this.listeners[event]) this.listeners[event].push(cb); return this }
    emit (event, arg) { for (const l of this.listeners[event].slice()) l(arg) }
  }

  // One MQTT connection to one broker: CONNECT on open, SUBSCRIBE after CONNACK, PINGREQ every 15 s.
  class MqttBrokerSocket {
    constructor (url, clientId, subscriptions, onMessage, onStatus, wsFactory, will) {
      Object.assign(this, { url, clientId, subscriptions, onMessage, onStatus, wsFactory, will })
      this.ws = null
      this.stream = new MqttStreamDecoder()
      this.pingTimer = null
      this.packetId = 1
      this.connected = false
      this.closed = false
      this.connect()
    }

    get isConnected () { return this.connected }

    connect () {
      if (this.closed) return
      try {
        const ws = this.wsFactory(this.url, 'mqtt')
        ws.binaryType = 'arraybuffer'
        this.ws = ws
        ws.onopen = () => {
          if (this.closed || ws !== this.ws) return
          ws.send(encodeConnect({ clientId: this.clientId, keepAliveSec: 25, will: this.will }))
        }
        ws.onmessage = ev => {
          if (this.closed || ws !== this.ws) return
          const bytes = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data)
          for (const pkt of this.stream.push(bytes)) {
            if (pkt.type === 'connack' && pkt.returnCode === 0) {
              this.connected = true
              if (this.subscriptions.length) ws.send(encodeSubscribe(this.packetId++, this.subscriptions))
              this.startPing()
              this.onStatus(true)
            } else if (pkt.type === 'publish') {
              this.onMessage(pkt.topic, decoder.decode(pkt.payload))
            }
          }
        }
        const down = () => {
          if (ws !== this.ws) return
          const was = this.connected
          this.connected = false
          this.stopPing()
          if (was) this.onStatus(false)
        }
        ws.onclose = down
        ws.onerror = down
      } catch (e) {
        this.onStatus(false)
      }
    }

    publish (topic, payload) {
      if (!this.connected || !this.ws || this.ws.readyState !== 1) return false
      try { this.ws.send(encodePublish(topic, payload)); return true } catch (e) { return false }
    }

    startPing () {
      this.stopPing()
      this.pingTimer = setInterval(() => {
        if (this.connected && this.ws && this.ws.readyState === 1) { try { this.ws.send(encodePingReq()) } catch (e) { /* onclose follows */ } }
      }, 15000)
    }

    stopPing () { clearInterval(this.pingTimer); this.pingTimer = null }

    close () {
      this.closed = true
      this.stopPing()
      if (this.ws) {
        try {
          if (this.connected && this.ws.readyState === 1) this.ws.send(encodeDisconnect())
          this.ws.close()
        } catch (e) { /* closing anyway */ }
        this.ws = null
      }
      this.connected = false
    }
  }

  // ---- TV side: one adapter per phone, looking like a PeerJS DataConnection ----
  class HostClientAdapter extends EventHub {
    constructor (connectionId, clientId, clientNonce, session, publishToClient, onClosed, linkOpts) {
      super()
      Object.assign(this, { connectionId, clientId, clientNonce, onClosed })
      this.relayed = true
      this.open = true
      this.lastSeen = Date.now()
      this.link = new ReliableLink(session, publishToClient, {
        onData: d => this.emit('data', d),
        onControl: f => { if (f.k === 'ping') this.link.control({ k: 'pong' }); else if (f.k === 'bye') this.close() },
        onBroken: () => this.close(),
      }, linkOpts)
    }

    send (data) { if (this.open) this.link.send(data) }

    close () {
      if (!this.open) return
      this.open = false
      this.link.closeWith({ k: 'bye' })   // tell the phone (unlike mafia-online, so a kicked or replaced link hears at once)
      this.onClosed(this.clientId)
      this.emit('close')
    }
  }

  // The TV listens on every broker at once, so a phone can use whichever one it reaches.
  // opts: { onConnection(conn), onStatusChange(online), brokers, wsFactory, heartbeatTimeoutMs, link }
  class MqttHostServer {
    constructor (roomCode, secret, opts) {
      Object.assign(this, { roomCode, secret, opts })
      this.sockets = new Map()
      this.clients = new Map()          // clientId -> { adapter, brokerUrl }
      this.replayGuard = new HandshakeReplayGuard()
      this.sweepTimer = null
      this.retryTimers = new Map()
      this.destroyed = false
      this.init()
    }

    get isOnline () {
      for (const s of this.sockets.values()) if (s.isConnected) return true
      return false
    }

    async init () {
      const keys = await deriveRoomKeys(this.roomCode, this.secret)
      if (this.destroyed) return
      const wsFactory = this.opts.wsFactory || defaultWsFactory
      for (const url of this.opts.brokers || BROKERS) this.connectBroker(url, keys.topicHash, keys.roomAuthKey, wsFactory)
      const timeout = this.opts.heartbeatTimeoutMs ?? 16000
      this.sweepTimer = setInterval(() => {   // drop phones that went silent
        const now = Date.now()
        for (const { adapter } of this.clients.values()) if (now - adapter.lastSeen > timeout) adapter.close()
      }, Math.min(3000, Math.floor(timeout / 3)))
      // A sealed "the TV is leaving", kept ready so destroy() can send it without waiting: a
      // closing page can't finish anything async. Re-sealed every minute, because phones
      // ignore one older than the handshake limit (so a recorded copy can't be replayed).
      // Not in mafia-online: there, phones only notice after 16 s of silence.
      const seal = () => encryptHandshake(keys.roomAuthKey, keys.topicHash, { t: 'bye', clientId: 'host', clientNonce: '', ts: Date.now() })
        .then(w => { this.hostBye = { topic: `${TOPIC}/${keys.topicHash}/bye`, wire: w } })
      seal()
      this.byeTimer = setInterval(seal, 60000)
    }

    connectBroker (url, topicHash, roomAuthKey, wsFactory) {
      if (this.destroyed) return
      const sock = new MqttBrokerSocket(url, 'actn-h-' + randomHex(6), [`${TOPIC}/${topicHash}/join`, `${TOPIC}/${topicHash}/h/+`],
        (topic, payload) => { this.handleIncoming(url, topicHash, roomAuthKey, topic, payload) },
        connected => {
          if (this.destroyed) return
          if (this.opts.onStatusChange) this.opts.onStatusChange(this.isOnline)
          if (!connected) {
            clearTimeout(this.retryTimers.get(url))
            this.retryTimers.set(url, setTimeout(() => this.connectBroker(url, topicHash, roomAuthKey, wsFactory), 3500))
          }
        },
        wsFactory)
      const old = this.sockets.get(url)
      if (old && old !== sock) old.close()
      this.sockets.set(url, sock)
    }

    async handleIncoming (brokerUrl, topicHash, roomAuthKey, topic, payload) {
      if (this.destroyed) return
      const dataPrefix = `${TOPIC}/${topicHash}/h/`

      if (topic === `${TOPIC}/${topicHash}/join`) {
        const syn = await decryptHandshake(roomAuthKey, topicHash, 'syn', payload)
        if (!syn || !syn.clientId || !syn.clientPub || !syn.clientNonce) return
        if (!this.replayGuard.checkAndRecord(syn)) return
        const hostKp = await generateEphemeralKeyPair()
        const sessionId = randomHex(12)
        const hostNonce = randomHex(12)
        let key
        try {
          key = await deriveSessionKey(hostKp.privateKey, syn.clientPub, this.roomCode.trim().toUpperCase(), syn.clientId, sessionId, syn.clientNonce, hostNonce)
        } catch (e) { return }
        if (this.destroyed) return
        const existing = this.clients.get(syn.clientId)
        if (existing) existing.adapter.close()
        const session = new EncryptedSession(sessionId, key, 'h2c', 'c2h')
        const down = `${TOPIC}/${topicHash}/c/${syn.clientId}`
        const ack = await encryptHandshake(roomAuthKey, topicHash,
          { t: 'syn-ack', clientId: syn.clientId, sessionId, hostPub: hostKp.publicKeyB64, clientNonce: syn.clientNonce, hostNonce })
        this.publishTo(brokerUrl, down, ack)
        const entry = { adapter: null, brokerUrl }
        const adapter = new HostClientAdapter(`mqtt-${syn.clientId}-${sessionId.slice(0, 6)}`, syn.clientId, syn.clientNonce, session,
          msg => this.publishTo(entry.brokerUrl, down, msg),
          cid => { const cur = this.clients.get(cid); if (cur && cur.adapter === adapter) this.clients.delete(cid) },
          this.opts.link)
        entry.adapter = adapter
        this.clients.set(syn.clientId, entry)
        this.opts.onConnection(adapter)
        adapter.emit('open')
        return
      }

      if (topic.startsWith(dataPrefix)) {
        const clientId = topic.slice(dataPrefix.length)
        const entry = this.clients.get(clientId)
        if (!entry) return
        entry.brokerUrl = brokerUrl                      // answer on the broker the phone uses now
        if (await entry.adapter.link.receive(payload)) { entry.adapter.lastSeen = Date.now(); return }
        // Not a session frame: maybe the sealed Last Will the broker sends when a phone vanishes.
        // It must carry this session's nonce, so an old will can't end a newer session.
        const lwt = await decryptHandshake(roomAuthKey, topicHash, 'bye', payload)
        if (lwt && lwt.clientId === clientId && lwt.clientNonce === entry.adapter.clientNonce) entry.adapter.close()
      }
    }

    publishTo (preferred, topic, payload) {
      const p = this.sockets.get(preferred)
      if (p && p.publish(topic, payload)) return
      for (const s of this.sockets.values()) if (s.publish(topic, payload)) return
    }

    destroy () {
      this.destroyed = true
      clearInterval(this.sweepTimer)
      clearInterval(this.byeTimer)
      if (this.hostBye) for (const s of this.sockets.values()) s.publish(this.hostBye.topic, this.hostBye.wire)
      for (const t of this.retryTimers.values()) clearTimeout(t)
      this.retryTimers.clear()
      for (const { adapter } of [...this.clients.values()]) adapter.close()
      this.clients.clear()
      for (const s of this.sockets.values()) s.close()
      this.sockets.clear()
    }
  }

  // ---- Phone side: tries brokers one at a time (3 s each) until the handshake completes ----
  // opts: { brokers, wsFactory, brokerAttemptTimeoutMs, heartbeatIntervalMs, heartbeatTimeoutMs, link }
  class MqttClientConnection extends EventHub {
    constructor (roomCode, secret, opts = {}) {
      super()
      Object.assign(this, { roomCode, secret, opts })
      this.connectionId = 'mqtt-c-' + randomHex(6)
      this.relayed = true
      this.open = false
      this.clientId = randomHex(8)
      this.sock = null
      this.link = null
      this.closed = false
      this.attemptTimer = null
      this.heartbeatTimer = null
      this.lastHostSeen = 0
      this.start()
    }

    async start () {
      let keys
      try { keys = await deriveRoomKeys(this.roomCode, this.secret) } catch (e) { this.emit('error'); this.close(); return }
      if (this.closed) return
      const wsFactory = this.opts.wsFactory || defaultWsFactory
      for (const url of this.opts.brokers || BROKERS) {
        if (this.closed || this.open) return
        if (await this.tryBroker(url, keys.topicHash, keys.roomAuthKey, wsFactory, this.opts.brokerAttemptTimeoutMs ?? 3000) || this.closed) return
      }
      if (!this.closed && !this.open) { this.emit('error'); this.close() }
    }

    async tryBroker (url, topicHash, roomAuthKey, wsFactory, timeoutMs) {
      const kp = await generateEphemeralKeyPair()
      const clientNonce = randomHex(12)
      const down = `${TOPIC}/${topicHash}/c/${this.clientId}`
      const up = `${TOPIC}/${topicHash}/h/${this.clientId}`
      // If this phone vanishes, the broker publishes this sealed "bye" so the TV knows at once.
      const will = encoder.encode(await encryptHandshake(roomAuthKey, topicHash, { t: 'bye', clientId: this.clientId, clientNonce, ts: Date.now() }))
      if (this.closed) return false
      return new Promise(resolve => {
        let settled = false
        const finish = ok => {
          if (settled) return
          settled = true
          clearTimeout(this.attemptTimer)
          this.attemptTimer = null
          resolve(ok)
        }
        this.attemptTimer = setTimeout(() => { if (!this.open) { sock.close(); finish(false) } }, timeoutMs)
        const byeTopic = `${TOPIC}/${topicHash}/bye`
        const sock = new MqttBrokerSocket(url, 'actn-c-' + this.clientId, [down, byeTopic],
          (topic, payload) => {
            if (this.closed) return
            if (topic === down) this.handleDownstream(payload, topicHash, roomAuthKey, kp.privateKey, clientNonce, up, sock, finish)
            else if (topic === byeTopic && this.open) {      // the TV is closing: reconnect now rather than after 16 s
              decryptHandshake(roomAuthKey, topicHash, 'bye', payload).then(bye => {
                if (bye && bye.clientId === 'host' && Math.abs(Date.now() - bye.ts) <= HANDSHAKE_TTL_MS && sock === this.sock) this.close()
              })
            }
          },
          connected => {
            if (this.closed) return
            if (connected) {
              encryptHandshake(roomAuthKey, topicHash, { t: 'syn', clientId: this.clientId, clientPub: kp.publicKeyB64, clientNonce, ts: Date.now() })
                .then(syn => sock.publish(`${TOPIC}/${topicHash}/join`, syn))
            } else if (settled && this.sock === sock) {
              this.close()
            } else if (!settled) {
              sock.close()
              finish(false)
            }
          },
          wsFactory, { topic: up, payload: will })
        this.sock = sock
      })
    }

    async handleDownstream (payload, topicHash, roomAuthKey, privateKey, nonce, up, sock, finish) {
      if (!this.link) {
        const ack = await decryptHandshake(roomAuthKey, topicHash, 'syn-ack', payload)
        if (!ack || ack.clientId !== this.clientId || ack.clientNonce !== nonce || !ack.hostPub || !ack.sessionId || !ack.hostNonce) return
        let key
        try {
          key = await deriveSessionKey(privateKey, ack.hostPub, this.roomCode.trim().toUpperCase(), this.clientId, ack.sessionId, nonce, ack.hostNonce)
        } catch (e) { return }
        if (this.closed || this.link || sock !== this.sock) return
        // Hold on to this socket: the final "bye" is sealed after close() has let go of this.sock.
        this.link = new ReliableLink(new EncryptedSession(ack.sessionId, key, 'c2h', 'h2c'), wire => sock.publish(up, wire), {
          onData: d => this.emit('data', d),
          onControl: f => { if (f.k === 'bye') this.close() },
          onBroken: () => this.close(),
        }, this.opts.link)
        this.open = true
        this.lastHostSeen = Date.now()
        this.startHeartbeats()
        finish(true)
        this.emit('open')
        return
      }
      if (await this.link.receive(payload)) this.lastHostSeen = Date.now()
    }

    startHeartbeats () {
      clearInterval(this.heartbeatTimer)
      const timeout = this.opts.heartbeatTimeoutMs ?? 16000
      this.heartbeatTimer = setInterval(() => {
        if (!this.open || !this.link) return
        if (Date.now() - this.lastHostSeen > timeout) { this.close(); return }
        this.link.control({ k: 'ping' })
      }, this.opts.heartbeatIntervalMs ?? 5000)
    }

    send (data) { if (this.open && this.link) this.link.send(data) }

    close () {
      if (this.closed) return
      const wasOpen = this.open
      this.closed = true
      this.open = false
      clearTimeout(this.attemptTimer)
      clearInterval(this.heartbeatTimer)
      const link = this.link, sock = this.sock
      if (wasOpen && link && sock && sock.isConnected) {
        link.closeWith({ k: 'bye' }).finally(() => sock.close())   // tell the TV, then hang up
      } else {
        if (link) link.close()
        if (sock) sock.close()
      }
      this.sock = null
      if (wasOpen) this.emit('close')
    }
  }

  // True when a direct WebRTC link actually goes through a TURN relay. Check ~1.5 s after open.
  async function usesRelay (pc) {
    if (!pc) return false
    try {
      const stats = await pc.getStats()
      let pairId, pair
      stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId })
      stats.forEach(r => {
        const selected = pairId ? r.id === pairId : r.nominated && r.state === 'succeeded'
        if (r.type === 'candidate-pair' && selected) pair = r
      })
      if (!pair) return false
      const l = stats.get(pair.localCandidateId), rm = stats.get(pair.remoteCandidateId)
      return (l && l.candidateType === 'relay') || (rm && rm.candidateType === 'relay')
    } catch (e) {
      return false
    }
  }

  root.ActNatural = Object.assign(root.ActNatural || {}, {
    relay: {
      BROKERS, MqttHostServer, MqttClientConnection, newRoomSecret, isValidRoomSecret, usesRelay,
      _test: { MqttStreamDecoder, encodeConnect, encodePublish, encodeSubscribe, EncryptedSession, ReliableLink, deriveRoomKeys, encryptHandshake, decryptHandshake, HandshakeReplayGuard, TOPIC },
    },
  })
})()
