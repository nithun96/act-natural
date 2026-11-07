// Act Natural: the phone. ?room=CODE joins a game; with no parameters this is the landing page.
// The screen never shows anything that tells an onlooker which blob is yours.
(function () {
  'use strict'
  const { net } = window.ActNatural
  const params = net.params
  if (params.has('host')) return

  const app = document.createElement('main')
  app.className = 'phone'
  document.body.appendChild(app)
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // ---- Landing page ----
  if (!params.has('room')) {
    app.innerHTML =
      '<h1>Act <em>Natural</em></h1>' +
      '<p>A party game for a TV and everyone\'s phones.</p>' +
      '<form class="stack" id="f"><label for="code">Room code from the TV</label>' +
      '<input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" inputmode="text" required>' +
      '<button type="submit">Join</button></form>' +
      '<p class="links"><a href="how.html">How to play</a> · <a href="?host">Host on this screen</a> · <a href="?host&amp;demo=6">Demo</a></p>'
    document.getElementById('f').addEventListener('submit', e => {
      e.preventDefault()
      const code = net.cleanCode(document.getElementById('code').value)
      if (code.length === 5) location.href = net.joinUrl(code)
    })
    return
  }

  const code = net.cleanCode(params.get('room'))
  let token = net.store.get('token')
  if (!token) { token = net.newToken(); net.store.set('token', token) }
  let name = net.store.get('name') || ''

  let peer = null
  let conn = null
  let joined = false
  let wantJoin = false
  let retryTimer = null
  let myPos = null
  let rtt = null

  // ---- Screens ----
  function showNameForm (note) {
    app.classList.remove('playing')
    app.innerHTML =
      `<h1>Room <span class="mono">${esc(code)}</span></h1>` +
      (note ? `<p class="note" role="status">${esc(note)}</p>` : '') +
      '<form class="stack" id="f"><label for="name">Your name</label>' +
      `<input id="name" maxlength="20" autocomplete="nickname" required value="${esc(name)}">` +
      '<button type="submit">Join</button></form>'
    const input = document.getElementById('name')
    if (!name) input.focus()
    document.getElementById('f').addEventListener('submit', e => {
      e.preventDefault()
      name = input.value.trim().slice(0, 20)
      if (!name) return
      net.store.set('name', name)
      net.store.set('room', code)
      wantJoin = true
      showStatus('Connecting…')
      connect()
    })
  }

  function showStatus (text) {
    app.classList.remove('playing')
    app.innerHTML = `<p class="status big" role="status">${esc(text)}</p>`
  }

  // ---- Connection ----
  function connect () {
    clearTimeout(retryTimer)
    if (!peer || peer.destroyed) {
      peer = new Peer(net.peerOptions())
      peer.on('open', openConn)
      peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect() })
      peer.on('error', err => {
        if (err.type === 'peer-unavailable') {
          if (joined) retry('Lost the TV. Trying again…')
          else showNameForm(`No game with code ${code} is running. Check the code on the TV.`)
          return
        }
        retry('Connection problem (' + err.type + '). Trying again…')
      })
    } else if (peer.open) {
      openConn()
    }
  }

  function openConn () {
    if (conn) conn.close()
    conn = peer.connect(net.PREFIX + code, { serialization: 'json' })
    conn.on('open', () => conn.send({ t: 'join', name, token }))
    conn.on('data', onMessage)
    conn.on('close', () => { if (wantJoin) retry('Lost the TV. Trying again…') })
  }

  function retry (text) {
    if (!wantJoin) return
    showStatus(text)
    joined = false
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, 2000)
  }

  function send (msg) {
    if (conn && conn.open) { try { conn.send(msg) } catch (e) { /* closing */ } }
  }

  function onMessage (msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'you') {
      if (!joined) { joined = true; showController() }
    } else if (msg.t === 'full') {
      wantJoin = false
      showNameForm('This game is full (20 players).')
    } else if (msg.t === 'pos') {
      myPos = { x: msg.x, y: msg.y }
      drawMap()
    } else if (msg.t === 'pong') {
      const sent = pings.get(msg.id)
      if (sent) { pings.delete(msg.id); rtt = rtt == null ? performance.now() - sent : rtt * 0.7 + (performance.now() - sent) * 0.3 }
    }
  }

  // Round-trip time, so we can see the "under 150 ms" target being met.
  const pings = new Map()
  let pingId = 0
  setInterval(() => {
    if (!joined) return
    pingId++
    pings.set(pingId, performance.now())
    if (pings.size > 10) pings.delete(pings.keys().next().value)
    send({ t: 'ping', id: pingId })
    const el = document.getElementById('rtt')
    if (el && rtt != null) el.textContent = Math.round(rtt) + ' ms'
  }, 1000)

  // ---- Controller: a floating joystick anywhere on the screen ----
  let stick = { dx: 0, dy: 0, active: false }
  let mapEl = null

  function showController () {
    app.classList.add('playing')
    app.innerHTML =
      '<section class="pad" id="pad" aria-label="Joystick: drag anywhere to walk. Arrow keys also work.">' +
      '<p class="padhint" aria-hidden="true">Drag anywhere to walk</p>' +
      '<div class="base" id="base" hidden><div class="knob" id="knob"></div></div>' +
      '</section>' +
      '<footer class="bar">' +
      '<button type="button" class="hold" id="hold">Hold to see where you are</button>' +
      '<span class="rtt" id="rtt" aria-label="Delay to the TV"></span>' +
      '</footer>' +
      '<canvas class="map" id="map" width="320" height="180" hidden aria-hidden="true"></canvas>'
    const pad = document.getElementById('pad')
    const base = document.getElementById('base')
    const knob = document.getElementById('knob')
    mapEl = document.getElementById('map')
    const R = 64
    let origin = null
    let pid = null

    pad.addEventListener('pointerdown', e => {
      if (pid !== null) return
      pid = e.pointerId
      pad.setPointerCapture(pid)
      origin = { x: e.clientX, y: e.clientY }
      base.hidden = false
      base.style.left = origin.x + 'px'
      base.style.top = origin.y + 'px'
      knob.style.transform = 'translate(-50%, -50%)'
      stick = { dx: 0, dy: 0, active: true }
      e.preventDefault()
    })
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return
      let dx = (e.clientX - origin.x) / R
      let dy = (e.clientY - origin.y) / R
      const m = Math.hypot(dx, dy)
      if (m > 1) { dx /= m; dy /= m }
      stick.dx = dx; stick.dy = dy
      stickMoved()
      knob.style.transform = `translate(calc(-50% + ${dx * R}px), calc(-50% + ${dy * R}px))`
    })
    const end = e => {
      if (e.pointerId !== pid) return
      pid = null
      base.hidden = true
      release()
    }
    pad.addEventListener('pointerup', end)
    pad.addEventListener('pointercancel', end)

    const hold = document.getElementById('hold')
    const showMap = on => { mapEl.hidden = !on; if (on) drawMap() }
    hold.addEventListener('pointerdown', e => { e.preventDefault(); showMap(true) })
    hold.addEventListener('pointerup', () => showMap(false))
    hold.addEventListener('pointercancel', () => showMap(false))
    hold.addEventListener('pointerleave', () => showMap(false))
    hold.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); showMap(true) } })
    hold.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') showMap(false) })
    hold.addEventListener('contextmenu', e => e.preventDefault())

    keepAwake()
  }

  function release () {
    stick = { dx: 0, dy: 0, active: false }
    send({ t: 'in', dx: 0, dy: 0 })   // one zero on release, then silence
  }

  // Keyboard equivalent: arrow keys or WASD.
  const keys = new Set()
  const KEYMAP = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] }
  function keyStick () {
    let dx = 0, dy = 0
    for (const k of keys) { dx += KEYMAP[k][0]; dy += KEYMAP[k][1] }
    if (dx || dy) { stick = { dx, dy, active: true }; stickMoved() }
    else if (stick.active) release()
  }
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase()
    if (!joined || !KEYMAP[k] || e.target.tagName === 'INPUT') return
    keys.add(k); keyStick(); e.preventDefault()
  })
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase()
    if (keys.delete(k)) keyStick()
  })

  // Input goes out at most 15 times a second while the stick is held. A move is sent at
  // once if the last send was long enough ago, so a thumb never waits for the next tick.
  let lastSent = 0
  function sendStick () {
    if (!joined || !stick.active) return
    lastSent = performance.now()
    send({ t: 'in', dx: Math.round(stick.dx * 100) / 100, dy: Math.round(stick.dy * 100) / 100 })
  }
  function stickMoved () {
    if (performance.now() - lastSent >= 1000 / net.INPUT_HZ - 5) sendStick()
  }
  setInterval(() => { if (performance.now() - lastSent >= 1000 / net.INPUT_HZ - 5) sendStick() }, 1000 / net.INPUT_HZ / 2)

  // The hold-to-see map: the room's outline and your own dot, nothing else.
  function drawMap () {
    if (!mapEl || mapEl.hidden || !myPos) return
    const c = mapEl.getContext('2d')
    const w = mapEl.width, h = mapEl.height
    c.fillStyle = '#1F1C18'; c.fillRect(0, 0, w, h)
    c.strokeStyle = '#3A342C'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4)
    c.fillStyle = '#B8AE9C'
    for (const lm of window.ActNatural.sim.LANDMARKS) {
      c.beginPath(); c.arc(lm.x / 1600 * w, lm.y / 900 * h, 4, 0, Math.PI * 2); c.fill()
    }
    c.fillStyle = '#B48AE8'
    c.beginPath(); c.arc(myPos.x * w, myPos.y * h, 9, 0, Math.PI * 2); c.fill()
  }

  // Keep the screen on while playing.
  let lock = null
  async function keepAwake () {
    try { if (navigator.wakeLock && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null }) } } catch (e) { /* not allowed: fine */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && joined) keepAwake()
    if (document.visibilityState === 'hidden' && stick.active) release()
  })

  // A phone that reloads during a game rejoins on its own.
  if (name && net.store.get('room') === code) {
    wantJoin = true
    showStatus('Rejoining…')
    connect()
  } else {
    showNameForm()
  }
})()
