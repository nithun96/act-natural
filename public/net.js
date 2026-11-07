// Act Natural: what the TV and the phones share about the network.
// PeerJS's public server only introduces the devices; game data then goes directly
// between them over WebRTC.
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

  function peerOptions (route) {
    const opts = { debug: 1 }
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
        path: new URL('peer/', location.href).pathname,   // /lab/act-natural/peer/
        secure,
      })
    }
    return opts                                          // 'cloud': PeerJS's defaults
  }

  // Errors that mean "this route can't reach an introduction server", so try the next one.
  const UNREACHABLE = ['network', 'server-error', 'socket-error', 'socket-closed']

  function joinUrl (code) {
    const u = new URL(location.pathname, location.origin)
    u.searchParams.set('room', code)
    if (params.get('signal')) u.searchParams.set('signal', params.get('signal'))
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
    net: { params, PREFIX, makeCode, cleanCode, peerOptions, ROUTES, UNREACHABLE, joinUrl, store, newToken, INPUT_HZ: 15, POS_HZ: 10 },
  })
})()
