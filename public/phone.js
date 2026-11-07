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
  let everJoined = false   // once in, a missing TV means it's reloading: keep trying
  let wantJoin = false
  let routeI = 0
  let retryTimer = null
  let myPos = null
  let rtt = null

  // ---- No zooming while playing: a pinch or double tap mid-game would wreck the controls ----
  // Only on the controller; the name form and other pages zoom as normal.
  const viewport = document.querySelector('meta[name=viewport]')
  const VIEWPORT = viewport.content
  let zoomLocked = false
  const stopGesture = e => { if (zoomLocked) e.preventDefault() }
  const stopPinch = e => { if (zoomLocked && e.touches && e.touches.length > 1) e.preventDefault() }
  document.addEventListener('gesturestart', stopGesture, { passive: false })   // iOS Safari
  document.addEventListener('gesturechange', stopGesture, { passive: false })
  document.addEventListener('touchmove', stopPinch, { passive: false })
  let lastTouchEnd = 0
  document.addEventListener('touchend', e => {                                  // double tap
    const now = Date.now()
    if (zoomLocked && now - lastTouchEnd < 350 && !e.target.closest('button')) e.preventDefault()   // a quick tap on Shoot must still click
    lastTouchEnd = now
  }, { passive: false })
  function lockZoom (on) {
    zoomLocked = on
    document.documentElement.classList.toggle('no-zoom', on)
    viewport.content = on ? VIEWPORT + ', maximum-scale=1, user-scalable=no' : VIEWPORT
  }

  // ---- Screens ----
  function showNameForm (note) {
    screen = null
    app.classList.remove('playing')
    lockZoom(false)
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
      showStatus('Connecting… (1 of 3: reaching the join server)')
      connect()
    })
  }

  function showStatus (text, note) {
    screen = null
    app.classList.remove('playing')
    lockZoom(false)
    app.innerHTML = `<p class="status big" role="status">${esc(text)}</p>` + (note && note !== text ? `<p class="note">Last try: ${esc(note)}</p>` : '')
  }

  // ---- Connection ----
  function connect () {
    clearTimeout(retryTimer)
    if (!peer || peer.destroyed) {
      // Introductions through nithun.no first, PeerJS's own server second (net.ROUTES).
      const p = new Peer(net.peerOptions(net.ROUTES[routeI]))
      peer = p
      p.on('open', () => { if (p === peer) { p.everOpen = true; openConn() } })
      p.on('disconnected', () => { if (p === peer && p.everOpen && !p.destroyed) p.reconnect() })
      p.on('error', err => {
        if (p !== peer) return
        if (net.UNREACHABLE.includes(err.type) && !p.everOpen) {   // this route is blocked or down: try the next
          p.destroy()
          routeI = (routeI + 1) % net.ROUTES.length
          if (routeI === 0) { retry('Can\'t reach the join server. Trying again…'); return }
          connect()
          return
        }
        if (err.type === 'peer-unavailable') {
          if (everJoined) retry('Lost the TV. Trying again…')
          else showNameForm(`No game with code ${code} is running. Check the code on the TV.`)
          return
        }
        retry('Connection problem (' + err.type + '). Trying again…')
      })
    } else if (peer.open) {
      openConn()
    }
  }

  // Steps shown on screen while joining, so a stuck phone says where it's stuck.
  // The direct link (step 3) can hang when a network blocks device-to-device traffic: give up after 15 s.
  let linkTimer = null
  function openConn () {
    if (conn) conn.close()
    if (!joined) showStatus('Connecting… (2 of 3: finding the TV)', lastProblem)
    const c = peer.connect(net.PREFIX + code, { serialization: 'json' })
    conn = c
    clearTimeout(linkTimer)
    // PeerJS says "peer-unavailable" quickly if the TV isn't there; otherwise we're on to the direct link.
    setTimeout(() => { if (conn === c && !c.open && !joined) showStatus('Connecting… (3 of 3: linking directly to the TV)', lastProblem) }, 1500)
    linkTimer = setTimeout(() => {
      if (conn !== c || c.open) return
      c.close()
      retry('Couldn\'t link directly to the TV. The Wi‑Fi may block devices talking to each other; try mobile data or another network. Trying again…')
    }, 15000)
    c.on('open', () => { clearTimeout(linkTimer); c.send({ t: 'join', name, token }) })
    c.on('data', onMessage)
    c.on('error', err => { if (conn === c) retry('Connection problem (' + (err && err.type || 'data channel') + '). Trying again…') })
    c.on('close', () => { if (conn === c && wantJoin) retry('Lost the TV. Trying again…') })
  }

  let lastProblem = ''   // kept on screen during the next try, so it doesn't flash past
  function retry (text) {
    if (!wantJoin) return
    lastProblem = text
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
      everJoined = true
      joined = true
      lastProblem = ''
      me = Object.assign({}, me, msg, { tasks: Array.isArray(msg.tasks) ? msg.tasks : [], hold: 0 })
      const { sim, maps } = window.ActNatural
      if (msg.map && msg.map !== sim.mapId()) { sim.setMap(maps.byId(msg.map)); drawMap(); drawHunt() }
      render()
    } else if (msg.t === 'full') {
      wantJoin = false
      showNameForm('This game is full (20 players).')
    } else if (msg.t === 'pos') {
      myPos = { x: msg.x, y: msg.y }
      me.hold = Number(msg.hold) || 0
      if (msg.tl != null) { me.timeLeft = msg.tl; updateClock() }
      const bar = document.getElementById('holdbar')
      if (bar) bar.style.width = Math.round(me.hold * 100) + '%'
      drawMap()
    } else if (msg.t === 'all') {
      hunt = msg
      me.timeLeft = msg.tl
      updateClock()
      if (sel != null && !msg.b.some(([a, , , st]) => a === sel && st === 0)) setSel(null)
      drawHunt()
    } else if (msg.t === 'event') {
      toast(msg.kind === 'caught' ? `Caught ${msg.name}! +3` : 'That was a bot. Shot wasted.')
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

  // ---- Screens by game phase: controller (lobby and hiding), Hunter, caught, results ----
  let screen = null
  let me = { tasks: [], done: 0, score: 0, hold: 0, phase: 'lobby', role: 'hider' }   // from the TV
  function render () {
    const kind = me.phase === 'round' && me.role === 'hunter' ? 'hunter'
      : me.phase === 'round' && me.caught ? 'caught'
        : me.phase === 'results' || me.phase === 'over' ? 'results'
          : 'controller'
    if (kind !== screen) {
      if (stick.active) release()
      screen = kind
      lockZoom(true)
      mapEl = null
      hmapEl = null
      ;({ controller: showController, hunter: showHunter, caught: showCaught, results: showResults })[kind]()
    } else if (kind === 'controller') { renderTasks(); renderStatus() } else if (kind === 'hunter') { renderHunter() } else if (kind === 'results') { showResults() } else { renderStatus() }
  }

  const clock = t => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`
  function renderStatus () {
    const el = document.getElementById('statusline')
    if (!el) return
    if (me.phase === 'round') {
      el.innerHTML = `<span>Round ${me.round} · ${me.role === 'hunter' ? 'You\'re the Hunter' : 'Hunter: ' + esc(me.hunter || '')}</span><span class="clock" id="clock"></span>`
      updateClock()
    } else {
      el.innerHTML = '<span>Warm-up: find your blob. Waiting for the host to start.</span>'
    }
  }
  function updateClock () {
    const el = document.getElementById('clock')
    if (!el || me.timeLeft == null) return
    el.textContent = clock(me.timeLeft)
    el.classList.toggle('low', me.timeLeft <= 10)
  }

  // ---- Controller: map on top, your tasks, and the joystick area below ----
  let stick = { dx: 0, dy: 0, active: false }
  let mapEl = null
  const LM = () => window.ActNatural.sim.LANDMARKS
  const lmName = id => (LM().find(l => l.id === id) || { name: id }).name

  function showController () {
    app.classList.add('playing')
    app.innerHTML =
      '<p class="status-line" id="statusline"></p>' +
      '<canvas class="map" id="map" aria-hidden="true"></canvas>' +
      '<section class="tasks" aria-live="polite">' +
      '<ol id="tasklist"></ol>' +
      '<p class="score"><span id="score">0</span> pts <span class="rtt" id="rtt" aria-label="Delay to the TV"></span></p>' +
      '</section>' +
      '<section class="pad" id="pad" aria-label="Joystick: drag anywhere here to walk. Arrow keys also work.">' +
      '<p class="padhint" aria-hidden="true">Drag here to walk</p>' +
      '<div class="base" id="base" hidden><div class="knob" id="knob"></div></div>' +
      '</section>'
    const pad = document.getElementById('pad')
    const base = document.getElementById('base')
    const knob = document.getElementById('knob')
    mapEl = document.getElementById('map')
    sizeMap()
    renderTasks()
    renderStatus()
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

    keepAwake()
  }

  // The task list: three landmarks in order. Done ones are ticked, the next one is marked.
  function renderTasks () {
    const ol = document.getElementById('tasklist')
    if (!ol) return
    document.getElementById('score').textContent = me.score
    if (!me.tasks.length) { ol.innerHTML = '<li class="next">Your three landmarks appear when the round starts.</li>'; return }
    ol.innerHTML = me.tasks.map((id, i) => {
      const state = i < me.done ? 'done' : i === me.done ? 'next' : 'later'
      const label = state === 'done' ? ' (done)' : state === 'next' ? ' (next)' : ''
      return `<li class="${state}"><span class="tick" aria-hidden="true">${state === 'done' ? '✓' : state === 'next' ? '→' : i + 1}</span>${esc(lmName(id))}<span class="sr">${label}</span>` +
        (state === 'next' ? '<span class="bar" aria-hidden="true"><span id="holdbar"></span></span>' : '') + '</li>'
    }).join('') + (me.done >= me.tasks.length ? '<li class="alldone">All three done: +2 bonus</li>' : '')
    document.getElementById('score').textContent = me.score
  }

  function sizeMap () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    for (const el of [mapEl, hmapEl]) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      el.width = Math.round(r.width * dpr)
      el.height = Math.round(r.height * dpr)
    }
    drawMap()
    drawHunt()
  }
  window.addEventListener('resize', sizeMap)

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

  // The map: the room, the landmarks by name, your next landmark ringed, and your own dot.
  function drawMap () {
    if (!mapEl || !mapEl.width) return
    const c = mapEl.getContext('2d')
    const w = mapEl.width, h = mapEl.height
    const k = w / 400                       // text and dots scale with the map
    c.fillStyle = '#1F1C18'; c.fillRect(0, 0, w, h)
    c.strokeStyle = '#3A342C'; c.lineWidth = 3 * k; c.strokeRect(1.5 * k, 1.5 * k, w - 3 * k, h - 3 * k)
    const next = me.tasks[me.done]
    const RANGE = window.ActNatural.sim.TASK_RANGE
    c.textAlign = 'center'; c.textBaseline = 'top'
    c.font = `${11 * k}px system-ui, sans-serif`
    for (const lm of LM()) {
      const x = lm.x / 1600 * w, y = lm.y / 900 * h
      if (lm.id === next) {
        c.beginPath(); c.arc(x, y, RANGE / 1600 * w, 0, Math.PI * 2)
        c.fillStyle = 'rgba(240,210,140,0.12)'; c.fill()
        c.strokeStyle = '#F0D28C'; c.lineWidth = 2 * k; c.stroke()
        if (me.hold > 0) {                  // fills up while you stand there
          c.beginPath(); c.arc(x, y, RANGE / 1600 * w, -Math.PI / 2, -Math.PI / 2 + me.hold * Math.PI * 2)
          c.strokeStyle = '#F0D28C'; c.lineWidth = 5 * k; c.stroke()
        }
      }
      c.fillStyle = lm.id === next ? '#F0D28C' : '#B8AE9C'
      c.beginPath(); c.arc(x, y, 3.5 * k, 0, Math.PI * 2); c.fill()
      c.font = `${lm.id === next ? 'bold ' : ''}${11 * k}px system-ui, sans-serif`   // next: ring and bold, not just colour
      c.fillText(lm.name, x, y + 6 * k)
    }
    if (myPos) {
      // Your dot: bigger than the landmark dots and outlined, so it stands out without colour.
      c.beginPath(); c.arc(myPos.x * w, myPos.y * h, 7 * k, 0, Math.PI * 2)
      c.fillStyle = '#B48AE8'; c.fill()
      c.strokeStyle = '#E8DFC8'; c.lineWidth = 2.5 * k; c.stroke()
    }
  }

  // ---- Hunter: the whole room on the phone. Tap a blob to aim (a crosshair shows on the TV), then Shoot ----
  let hmapEl = null
  let hunt = null      // { b: [[alias, x, y, state]], tl, aim } — state 0 in play, 1 caught, 2 shot bot
  let sel = null

  function showHunter () {
    app.classList.add('playing')
    sel = null
    app.innerHTML =
      '<p class="status-line" id="statusline"></p>' +
      '<canvas class="map hunt" id="hmap" role="img" aria-label="Map of every blob. Tap one to aim. Arrow keys also choose."></canvas>' +
      '<div class="hunter-bar">' +
      '<p class="shots" id="shots"></p>' +
      '<button type="button" class="shoot" id="shoot" disabled>Shoot</button>' +
      '<p class="toast" id="toast" role="status"></p>' +
      '<p class="hint">Watch the TV. Tap a blob here to aim; everyone sees the crosshair. Arrow keys and Enter work too.</p>' +
      '</div>'
    hmapEl = document.getElementById('hmap')
    sizeMap()
    renderHunter()
    hmapEl.addEventListener('pointerdown', e => {
      e.preventDefault()
      if (!hunt) return
      const r = hmapEl.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
      let best = null, bestD = Infinity
      for (const [a, bx, by, st] of hunt.b) {
        if (st !== 0) continue
        const d = Math.hypot((bx - x) * r.width, (by - y) * r.height)
        if (d < bestD) { bestD = d; best = a }
      }
      setSel(bestD <= 36 ? best : null)
    })
    document.getElementById('shoot').addEventListener('click', shoot)
  }

  function setSel (a) {
    sel = a
    send({ t: 'aim', a })
    const btn = document.getElementById('shoot')
    if (btn) btn.disabled = sel == null || !me.shots
    drawHunt()
  }

  function shoot () {
    if (sel == null || !me.shots) return
    send({ t: 'shoot', a: sel })
    sel = null
    const btn = document.getElementById('shoot')
    if (btn) btn.disabled = true
  }

  function renderHunter () {
    renderStatus()
    const el = document.getElementById('shots')
    if (el) {
      const n = me.shots || 0
      el.innerHTML = `<span aria-hidden="true">${'●'.repeat(n)}${'○'.repeat(Math.max(0, 3 - n))}</span> ${n} ${n === 1 ? 'shot' : 'shots'} left`
    }
    const btn = document.getElementById('shoot')
    if (btn) btn.disabled = sel == null || !me.shots
  }

  let toastTimer = null
  function toast (text) {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = text
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { el.textContent = '' }, 3000)
  }

  // Keyboard for the Hunter: arrows step through blobs left to right, Enter or Space shoots.
  window.addEventListener('keydown', e => {
    if (screen !== 'hunter' || !hunt) return
    const k = e.key
    if (k === 'Enter' || k === ' ') { e.preventDefault(); shoot(); return }
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return
    e.preventDefault()
    const live = hunt.b.filter(b => b[3] === 0).sort((p, q) => p[1] - q[1] || p[2] - q[2])
    if (!live.length) return
    const i = live.findIndex(b => b[0] === sel)
    const step = k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1
    setSel(live[(i + step + live.length) % live.length][0])
  })

  function drawHunt () {
    if (!hmapEl || !hmapEl.width) return
    const c = hmapEl.getContext('2d')
    const w = hmapEl.width, h = hmapEl.height
    const k = w / 400
    c.fillStyle = '#1F1C18'; c.fillRect(0, 0, w, h)
    c.strokeStyle = '#3A342C'; c.lineWidth = 3 * k; c.strokeRect(1.5 * k, 1.5 * k, w - 3 * k, h - 3 * k)
    c.textAlign = 'center'; c.textBaseline = 'top'
    c.font = `${10 * k}px system-ui, sans-serif`
    c.fillStyle = '#7A7266'
    for (const lm of LM()) c.fillText(lm.name, lm.x / 1600 * w, lm.y / 900 * h + 4 * k)
    if (!hunt) return
    const R = 4.5 * k
    for (const [a, bx, by, st] of hunt.b) {
      const x = bx * w, y = by * h
      if (st === 0) {
        c.fillStyle = '#E8DFC8'
        c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill()
      } else {                                // caught or shot: hollow with a cross
        c.strokeStyle = '#7A7266'; c.lineWidth = 1.5 * k
        c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke()
        c.beginPath(); c.moveTo(x - R, y - R); c.lineTo(x + R, y + R); c.moveTo(x + R, y - R); c.lineTo(x - R, y + R); c.stroke()
      }
      if (a === sel) {                        // crosshair
        c.strokeStyle = '#F0D28C'; c.lineWidth = 2 * k
        c.beginPath(); c.arc(x, y, R * 2.4, 0, Math.PI * 2); c.stroke()
        c.beginPath()
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(x + dx * R * 1.6, y + dy * R * 1.6); c.lineTo(x + dx * R * 3.4, y + dy * R * 3.4) }
        c.stroke()
      }
    }
  }

  // ---- Caught: out until the round ends ----
  function showCaught () {
    app.classList.remove('playing')
    app.innerHTML =
      '<section class="card" role="status">' +
      '<p class="xeyes" aria-hidden="true">× ×</p>' +
      '<h2>Caught!</h2>' +
      `<p>You're out until the round ends. Your points stay: <strong>${me.score}</strong>.</p>` +
      '<p class="status-line" id="statusline"></p>' +
      '</section>'
    renderStatus()
  }

  // ---- Results: after each round, and the final scores ----
  function showResults () {
    app.classList.remove('playing')
    const over = me.phase === 'over'
    const what = me.role === 'hunter' ? 'You were the Hunter.' : me.caught ? 'You were caught.' : 'You made it to the end.'
    app.innerHTML =
      '<section class="card" role="status">' +
      `<h2>${over ? 'Final scores' : `Round ${me.round} over`}</h2>` +
      (over ? '' : `<p>${what} <strong>+${me.roundPts}</strong> this round.</p>`) +
      `<p class="big">${me.score}</p><p>points · place ${me.rank} of ${me.players}</p>` +
      `<p>${over ? 'Thanks for playing!' : me.last ? 'That was the last round. Final scores next.' : 'Watch the TV to see who was who. The next round starts soon.'}</p>` +
      '</section>'
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
