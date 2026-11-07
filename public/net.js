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

  // For testing only: ?signal=localhost:9000 uses a local PeerJS server instead of the public one.
  function peerOptions () {
    const sig = params.get('signal')
    const opts = { debug: 1 }
    if (sig && /^[\w.-]+:\d+$/.test(sig)) {
      const [host, port] = sig.split(':')
      Object.assign(opts, { host, port: Number(port), path: '/', secure: false })
    }
    return opts
  }

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
    net: { params, PREFIX, makeCode, cleanCode, peerOptions, joinUrl, store, newToken, INPUT_HZ: 15, POS_HZ: 10 },
  })
})()
