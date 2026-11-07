// Act Natural: the TV page.
//   ?host          the real game: phones join over the network and steer their blobs
//   ?host&demo=6   no network: 6 fake humans steered by the same virtual thumb as the bots
(function () {
  'use strict'
  const { sim, net } = window.ActNatural
  const params = net.params
  if (!params.has('host')) return   // phone.js handles every other address

  const demo = params.has('demo')
  const demoHumans = Math.max(0, Math.min(20, parseInt(params.get('demo') || '0', 10) || 0))
  const world = sim.createWorld({ humans: demoHumans })

  // ---- Fake humans: the same virtual thumb as the bots, through the human joystick path ----
  const fakes = world.blobs.filter(b => b.kind === 'human')
  for (const b of fakes) b.driver = sim.makeDriver()

  // ---- Network: the TV is the server. Players are kept by token so a reloaded phone gets its blob back ----
  const MAX_PLAYERS = 20
  const players = new Map()          // token -> { token, name, blob, conn, order }
  let roomCode = null
  let netStatus = demo ? 'demo' : 'starting'
  const lobby = demo ? null : buildLobby()

  // The room code is kept in this browser, so reloading the TV keeps the same room and
  // phones find their way back without scanning again (idea from mafia-online).
  let peer = null
  let takenTries = 0
  function startHost (code) {
    code = code || net.store.get('host-code') || net.makeCode()
    net.store.set('host-code', code)
    peer = new Peer(net.PREFIX + code, net.peerOptions())
    peer.on('open', () => { roomCode = code; netStatus = 'open'; renderLobby() })   // also fires after a reconnect
    peer.on('connection', conn => conn.on('data', msg => onMessage(conn, msg)))
    peer.on('disconnected', () => {
      netStatus = 'Lost contact with the PeerJS server (needed only for new phones to join). Trying again…'
      renderLobby()
      setTimeout(() => { if (!peer.destroyed) peer.reconnect() }, 2000)
    })
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && !roomCode) {
        // Just after a reload the server can hold the old connection's id for a few seconds.
        // Keep trying the same code for about 30 s; after that another screen has it, so pick a new one.
        peer.destroy()
        takenTries++
        if (takenTries <= 8) {
          netStatus = `Reopening room ${code}…`
          renderLobby()
          setTimeout(() => startHost(code), 4000)
        } else {
          takenTries = 0
          startHost(net.makeCode())
        }
        return
      }
      if (err.type === 'peer-unavailable') return                                            // a phone left; harmless
      netStatus = err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error'
        ? 'Can\'t reach the PeerJS server. Check this computer\'s internet connection.'
        : 'Network problem: ' + err.type
      renderLobby()
    })
  }

  function send (conn, msg) {
    if (conn && conn.open) { try { conn.send(msg) } catch (e) { /* closing */ } }
  }

  function onMessage (conn, msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'ping') { send(conn, { t: 'pong', id: msg.id }); return }
    if (msg.t === 'join') {
      const token = String(msg.token || '').slice(0, 64)
      const name = String(msg.name || '').trim().replace(/\s+/g, ' ').slice(0, 20)
      if (!token || !name) return
      let p = players.get(token)
      if (!p) {
        if (players.size >= MAX_PLAYERS) { send(conn, { t: 'full' }); return }
        p = { token, name, blob: sim.addHuman(world), conn: null, order: players.size }
        players.set(token, p)
      }
      if (p.conn && p.conn !== conn) p.conn.close()
      p.name = name
      p.conn = conn
      conn.player = p
      conn.on('close', () => { if (p.conn === conn) { p.conn = null; sim.setInput(p.blob, 0, 0); renderLobby() } })
      send(conn, { t: 'you', role: 'hider', phase: 'lobby', name: p.name })
      renderLobby()
      return
    }
    const p = conn.player
    if (!p) return
    if (msg.t === 'in') {
      const dx = Number(msg.dx), dy = Number(msg.dy)
      if (!isFinite(dx) || !isFinite(dy)) return
      const m = Math.hypot(dx, dy)
      sim.setInput(p.blob, m > 1 ? dx / m : dx, m > 1 ? dy / m : dy)
    }
  }

  // Each phone hears only where its own blob is (for its hold-to-see map), 10 times a second.
  if (!demo) {
    setInterval(() => {
      for (const p of players.values()) {
        send(p.conn, { t: 'pos', x: Math.round(p.blob.x / sim.W * 1000) / 1000, y: Math.round(p.blob.y / sim.H * 1000) / 1000 })
      }
    }, 1000 / net.POS_HZ)
  }

  // ---- Lobby panel: QR code, room code and who has joined (names are never drawn in the room) ----
  function buildLobby () {
    const el = document.createElement('aside')
    el.className = 'lobby'
    el.setAttribute('aria-live', 'polite')
    document.body.appendChild(el)
    return el
  }

  // The short address to type: no https://, no index.html, no trailing slash.
  function siteAddress () {
    return (location.host + location.pathname).replace(/index\.html$/, '').replace(/\/$/, '')
  }

  function renderLobby () {
    if (!lobby) return
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    if (!roomCode) {
      lobby.innerHTML = `<p class="status">${netStatus === 'starting' ? 'Opening the room…' : esc(netStatus)}</p>`
      return
    }
    const url = net.joinUrl(roomCode)
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    const list = [...players.values()].sort((a, b) => a.order - b.order)
      .map(p => `<li${p.conn ? '' : ' class="away"'}>${esc(p.name)}${p.conn ? '' : ' (away)'}</li>`).join('')
    lobby.innerHTML =
      `<h2>Join on your phone</h2>` +
      `<img class="qr" alt="QR code for ${esc(url)}" src="${qr.createDataURL(8, 2)}">` +
      `<p class="url">or go to <strong>${esc(siteAddress())}</strong> and enter</p>` +
      `<p class="code" aria-label="Room code ${roomCode.split('').join(' ')}">${roomCode}</p>` +
      `<h3>${players.size} ${players.size === 1 ? 'player' : 'players'}</h3><ul>${list}</ul>` +
      (netStatus === 'open' ? '' : `<p class="status">${esc(netStatus)}</p>`) +
      `<p class="keys">Q hides this panel · N starts a new room (everyone rejoins)</p>`
  }

  if (!demo) {
    renderLobby()
    startHost()
    window.addEventListener('pagehide', () => { if (peer) peer.destroy() })   // frees the room id at once
  }

  function newRoom () {
    net.store.set('host-code', net.makeCode())
    location.reload()
  }

  // ---- Canvas, scaled to fit the TV with the room's 16:9 shape kept ----
  const canvas = document.createElement('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Act Natural: a room of identical blobs wandering between five landmarks')
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 }

  function resize () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cw = window.innerWidth
    const ch = window.innerHeight
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    const pad = 0.03
    const s = Math.min(cw * (1 - pad * 2) / sim.W, ch * (1 - pad * 2) / sim.H)
    view = { s, ox: (cw - sim.W * s) / 2, oy: (ch - sim.H * s) / 2, dpr, cw, ch }
  }
  window.addEventListener('resize', resize)
  resize()

  const C = {
    bg: '#12110F', floor: '#1F1C18', floorLine: '#2A2621', wall: '#3A342C',
    label: '#B8AE9C', blob: '#E8DFC8', blobShade: '#C9BDA3', eye: '#1C1A17', shadow: 'rgba(0,0,0,0.35)',
    water: '#5E8BA0', waterLight: '#8DB4C4', stone: '#6E665A', leaf: '#5F7A4E', leafDark: '#4A6140',
    wood: '#8A6A4A', rug: '#7A4B5A', rugEdge: '#A87A6A', glow: 'rgba(240,210,140,0.10)', lampHead: '#F0D28C',
    reveal: '#B48AE8', hud: '#9A8E7E',
  }

  function drawFloor () {
    ctx.fillStyle = C.floor
    ctx.strokeStyle = C.wall
    ctx.lineWidth = 6
    roundRect(0, 0, sim.W, sim.H, 24)
    ctx.fill(); ctx.stroke()
    ctx.strokeStyle = C.floorLine
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 100; x < sim.W; x += 100) { ctx.moveTo(x, 6); ctx.lineTo(x, sim.H - 6) }
    for (let y = 100; y < sim.H; y += 100) { ctx.moveTo(6, y); ctx.lineTo(sim.W - 6, y) }
    ctx.stroke()
  }

  function roundRect (x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function circle (x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill() }

  // Landmarks sit under the blobs (except the tree canopy, drawn after them).
  function drawLandmark (lm, t) {
    const { x, y } = lm
    if (lm.kind === 'fountain') {
      circle(x, y, 70, C.stone)
      circle(x, y, 58, C.water)
      const ripple = 20 + ((t * 14) % 36)
      ctx.strokeStyle = C.waterLight; ctx.lineWidth = 2; ctx.globalAlpha = 1 - (ripple - 20) / 36
      ctx.beginPath(); ctx.arc(x, y, ripple, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1
      circle(x, y, 14, C.stone)
    } else if (lm.kind === 'lamp') {
      circle(x, y, 90, C.glow)
      circle(x, y, 50, C.glow)
      circle(x, y, 12, C.lampHead)
      ctx.strokeStyle = C.stone; ctx.lineWidth = 4
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke()
    } else if (lm.kind === 'bench') {
      ctx.fillStyle = C.wood
      roundRect(x - 80, y - 16, 160, 32, 6); ctx.fill()
      ctx.strokeStyle = C.floor; ctx.lineWidth = 3
      ctx.beginPath()
      for (let i = -1; i <= 1; i++) { ctx.moveTo(x - 76, y + i * 9); ctx.lineTo(x + 76, y + i * 9) }
      ctx.stroke()
    } else if (lm.kind === 'tree') {
      circle(x + 8, y + 10, 64, C.shadow)
      circle(x, y, 18, C.wood)
    } else if (lm.kind === 'rug') {
      ctx.fillStyle = C.rugEdge; roundRect(x - 110, y - 70, 220, 140, 10); ctx.fill()
      ctx.fillStyle = C.rug; roundRect(x - 98, y - 58, 196, 116, 6); ctx.fill()
      ctx.strokeStyle = C.rugEdge; ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(x, y, 60, 32, 0, 0, Math.PI * 2); ctx.stroke()
    }
  }

  function drawCanopy (lm) {
    if (lm.kind !== 'tree') return
    ctx.globalAlpha = 0.88
    circle(lm.x - 26, lm.y - 14, 42, C.leafDark)
    circle(lm.x + 24, lm.y - 18, 40, C.leafDark)
    circle(lm.x, lm.y + 16, 44, C.leafDark)
    circle(lm.x - 6, lm.y - 8, 40, C.leaf)
    circle(lm.x + 18, lm.y + 6, 30, C.leaf)
    ctx.globalAlpha = 1
  }

  function drawLabel (lm) {
    const below = { fountain: 96, lamp: 40, bench: 42, tree: 84, rug: 94 }[lm.kind]
    ctx.font = 'italic 26px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = C.label
    ctx.fillText(lm.name, lm.x, lm.y + below)
  }

  // Every blob is drawn by this one function, whatever it is.
  function drawBlob (b, reveal, alpha) {
    const R = sim.BLOB_R
    const x = b.px + (b.x - b.px) * alpha
    const y = b.py + (b.y - b.py) * alpha
    const moving = b.vx || b.vy
    const bob = moving && !reduceMotion ? Math.sin(b.walkPhase) : 0
    const sx = 1 + bob * 0.06
    const sy = 1 - bob * 0.06
    ctx.beginPath(); ctx.ellipse(x, y + R * 0.85, R * 0.9, R * 0.35, 0, 0, Math.PI * 2)
    ctx.fillStyle = C.shadow; ctx.fill()
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(sx, sy)
    const isHuman = reveal && b.kind === 'human'
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2)
    ctx.fillStyle = isHuman ? C.reveal : C.blob; ctx.fill()
    ctx.beginPath(); ctx.arc(-R * 0.25, R * 0.3, R * 0.7, 0, Math.PI * 2)
    ctx.globalAlpha = 0.25; ctx.fillStyle = C.blobShade; ctx.fill(); ctx.globalAlpha = 1
    const ex = Math.cos(b.facing) * R * 0.38
    const ey = Math.sin(b.facing) * R * 0.38 - R * 0.12
    const px = Math.cos(b.facing + Math.PI / 2) * R * 0.3
    const py = Math.sin(b.facing + Math.PI / 2) * R * 0.3
    circle(ex + px, ey + py, R * 0.16, C.eye)
    circle(ex - px, ey - py, R * 0.16, C.eye)
    ctx.restore()
  }

  // ---- Loop: fixed 60 Hz simulation, drawn on every animation frame ----
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const STEP = 1 / 60
  let acc = 0
  let last = performance.now()
  let paused = false
  let reveal = false
  let showHelp = true
  let fps = 60
  let fpsFrames = 0
  let fpsClock = 0

  function frame (now) {
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.25) dt = 0.25   // tab was hidden: don't fast-forward
    fpsFrames++; fpsClock += dt
    if (fpsClock >= 0.5) { fps = fpsFrames / fpsClock; fpsFrames = 0; fpsClock = 0 }
    if (!paused) {
      acc += dt
      while (acc >= STEP) { sim.step(world, STEP); acc -= STEP }
    }
    draw()
    requestAnimationFrame(frame)
  }

  function draw () {
    const { dpr, s, ox, oy, cw, ch } = view
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, cw, ch)
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy)
    drawFloor()
    for (const lm of world.landmarks) drawLandmark(lm, world.time)
    // Draw in y order so overlaps look natural and tell nothing.
    const order = world.blobs.slice().sort((a, b) => a.y - b.y)
    const alpha = paused ? 1 : acc / STEP   // draw between the last two steps (smooth at 120 Hz)
    for (const b of order) drawBlob(b, reveal, alpha)
    for (const lm of world.landmarks) drawCanopy(lm)
    for (const lm of world.landmarks) drawLabel(lm)

    // HUD, in screen pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const fs = Math.max(12, Math.round(ch * 0.018))
    ctx.font = `${fs}px system-ui, sans-serif`
    ctx.fillStyle = C.hud
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    const humans = demo ? fakes.length : players.size
    const bots = world.blobs.length - humans
    const what = demo ? `demo · ${humans} fake humans` : `room ${roomCode || '…'} · ${humans} ${humans === 1 ? 'player' : 'players'}`
    ctx.fillText(`Act Natural · ${what}, ${bots} bots${paused ? ' · paused' : ''}${reveal ? ' · REVEALED' : ''}`, ox + 8, Math.max(4, oy - fs - 4))
    ctx.textAlign = 'right'
    ctx.fillText(`${Math.round(fps)} fps`, ox + sim.W * s - 8, Math.max(4, oy - fs - 4))
    if (showHelp) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`Space pause · R reveal humans (testing only) · F full screen${lobby ? ' · Q join panel' : ''} · H hide this line`, cw / 2, ch - 4)
    }
  }

  window.addEventListener('keydown', e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === ' ') { paused = !paused; e.preventDefault() }
    else if (k === 'r') reveal = !reveal
    else if (k === 'h') showHelp = !showHelp
    else if (k === 'q' && lobby) lobby.hidden = !lobby.hidden
    else if (k === 'n' && lobby && confirm('Start a new room? Everyone will need to join again.')) newRoom()
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
    }
  })

  window.__actNatural = { world, players }   // for automated tests
  requestAnimationFrame(frame)
})()
