// Act Natural: what the TV and the phones share about the network.
// Two ways to reach the TV, the design from mafia-online's docs/p2p-networking.md:
//   1. direct WebRTC (PeerJS): its public server only introduces the devices, then game data
//      goes straight between them. Always preferred.
//   2. the encrypted MQTT relay (relay.js), for networks where 1 can't connect. Needs the
//      secret from the QR code.
(function () {
  'use strict'
  const params = new URLSearchParams(location.search)
  const PREFIX = 'act-natural-nithun-'
  const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'   // no I, L or O: easy to read off a TV

  function makeCode () {
    let c = ''
    for (let i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]
    return c
  }

  function cleanCode (s) {
    return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
  }

  // Where devices get introduced, in the order to try them:
  //   'proxy'  nithun.no forwards to PeerJS's server (nginx/nithun-website), for networks that block 0.peerjs.com
  //   'cloud'  PeerJS's public server directly
  // For testing only: ?signal=localhost:9000 uses a local PeerJS server instead of both.
  // Either way, game data then goes directly between the devices over WebRTC.
  const ROUTES = params.get('signal') ? ['signal'] : ['proxy', 'cloud']

  // How devices reach each other once introduced: directly if they can (STUN helps them find a
  // path through home routers), otherwise through our own relay (TURN) on nithun.no, login from
  // turn.js, made at build time. When even that fails, phones that scanned the QR code use the
  // encrypted MQTT relay instead (relay.js).
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
  function iceServers () {
    const t = window.ActNatural.turn
    if (!t) return STUN
    return [
      { urls: `stun:${t.host}:3478` },
      {
        urls: [`turn:${t.host}:3478?transport=udp`, `turn:${t.host}:3478?transport=tcp`, `turns:${t.host}:5349?transport=tcp`],
        username: t.username,
        credential: t.credential,
      },
      ...STUN,
    ]
  }

  function peerOptions (route) {
    const base = (window.peerjs && window.peerjs.util && window.peerjs.util.defaultConfig) || {}
    const opts = { debug: 1, config: Object.assign({}, base, { iceServers: iceServers() }) }
    if (route === 'signal') {
      const sig = params.get('signal')
      if (/^[\w.-]+:\d+$/.test(sig)) {
        const [host, port] = sig.split(':')
        Object.assign(opts, { host, port: Number(port), path: '/', secure: false })
      }
    } else if (route === 'proxy') {
      const secure = location.protocol === 'https:'
      Object.assign(opts, {
        host: location.hostname,
        port: Number(location.port) || (secure ? 443 : 80),
        path: new URL('peer/', location.href).pathname,   // /act-natural/peer/
        secure,
      })
    }
    return opts                                          // 'cloud': PeerJS's defaults
  }

  // Errors that mean "this route can't reach an introduction server", so try the next one.
  const UNREACHABLE = ['network', 'server-error', 'socket-error', 'socket-closed']

  // The QR code's link carries the relay secret in the #fragment, which browsers never send to
  // any server. A typed room code has no secret, so it can only link directly.
  function joinUrl (code, secret) {
    const u = new URL(location.pathname, location.origin)
    u.searchParams.set('room', code)
    if (params.get('signal')) u.searchParams.set('signal', params.get('signal'))
    if (secret) u.hash = 'k=' + secret
    return u.toString()
  }

  const store = {
    get (k) { try { return localStorage.getItem('act-natural-' + k) } catch (e) { return null } },
    set (k, v) { try { localStorage.setItem('act-natural-' + k, v) } catch (e) { /* private mode */ } },
  }

  function newToken () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, {
    net: { params, PREFIX, RELAY_HEAD_START_MS: 5000, DIRECT_TIMEOUT_MS: 15000, UPGRADE_EVERY_MS: 30000, makeCode, cleanCode, peerOptions, ROUTES, UNREACHABLE, joinUrl, store, newToken, INPUT_HZ: 15, POS_HZ: 10 },
  })
})()
