// Act Natural: the TV page.
//   ?host          the real game: phones join over the network and steer their blobs
//   ?host&demo=6   no network: 6 fake humans steered by the same virtual thumb as the bots
(function () {
  'use strict'
  const { sim, net, round, maps, art } = window.ActNatural
  const params = net.params
  if (!params.has('host')) return   // phone.js handles every other address

  const demo = params.has('demo')
  // The map: chosen in the lobby (M), remembered on this computer. ?map=jaffna picks one directly.
  let map = maps.byId(params.get('map') || net.store.get('map') || 'park')
  sim.setMap(map)
  const demoHumans = Math.max(0, Math.min(20, parseInt(params.get('demo') || '0', 10) || 0))
  const world = sim.createWorld({ humans: demoHumans })

  // ---- Fake humans: the same virtual thumb as the bots, through the human joystick path ----
  const fakes = world.blobs.filter(b => b.kind === 'human')
  for (const b of fakes) b.driver = sim.makeDriver()

  // ---- Network: the TV is the server. Players are kept by token so a reloaded phone gets its blob back ----
  const game = demo ? null : round.create(world)   // the rules: rounds, Hunter, scores (round.js)
  const players = game ? game.players : new Map()   // token -> { token, name, blob, conn, order, score, task, … }
  let roomCode = null
  let netStatus = demo ? 'demo' : 'starting'
  const lobby = demo ? null : buildLobby()

  // The room code and the relay secret are kept in this browser, so reloading the TV keeps the
  // same room and phones find their way back without scanning again (idea from mafia-online).
  // The TV is reachable two ways at once (net.js): a PeerJS id for direct links, and the
  // encrypted MQTT relay (relay.js) for phones that can't link directly.
  const relay = window.ActNatural.relay
  let code = null
  let secret = net.store.get('host-secret')
  if (!relay.isValidRoomSecret(secret)) { secret = relay.newRoomSecret(); net.store.set('host-secret', secret) }
  let peer = null
  let peerOpen = false
  let mqtt = null
  let mqttOnline = false
  let takenTries = 0

  function useCode (c) {
    code = c
    net.store.set('host-code', c)
    if (mqtt) mqtt.destroy()
    mqttOnline = false
    mqtt = new relay.MqttHostServer(c, secret, {
      onConnection: accept,
      onStatusChange: online => { mqttOnline = online; updateNet() },
    })
  }

  // Introductions go through nithun.no first and PeerJS's own server second (net.ROUTES).
  // A route that can't be reached before the room opens moves on to the next one.
  let routeI = 0
  let routeWraps = 0
  function startHost () {
    const route = net.ROUTES[routeI]
    const p = new Peer(net.PREFIX + code, net.peerOptions(route))
    peer = p
    p.on('open', () => {                                  // also after a reconnect
      if (p !== peer) return
      p.everOpen = true
      peerOpen = true
      takenTries = 0
      joinRoute = route
      routeWraps = 0
      reconnectTries = 0
      updateNet()
    })
    p.on('connection', accept)
    // Losing the PeerJS server only stops new direct links; phones already in talk to the TV
    // directly and keep playing. Retry quickly, then less often, for as long as it takes.
    p.on('disconnected', () => {
      if (p !== peer || !p.everOpen) return
      peerOpen = false
      updateNet()
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(reconnect, Math.min(1000 * 2 ** reconnectTries, 15000))
      reconnectTries++
    })
    p.on('error', err => {
      if (p !== peer) return
      if (err.type === 'unavailable-id' && !p.everOpen) {
        // Just after a reload the server can hold the old connection's id for a few seconds.
        // Keep trying the same code for about 30 s; after that another screen has it, so pick a new one.
        p.destroy()
        takenTries++
        if (takenTries > 8) { takenTries = 0; useCode(net.makeCode()) }
        updateNet()
        setTimeout(startHost, takenTries ? 4000 : 0)
        return
      }
      if (err.type === 'peer-unavailable') return                                            // a phone left; harmless
      if (net.UNREACHABLE.includes(err.type)) {
        if (!p.everOpen) {                                 // never got in on this route: try the next
          p.destroy()
          routeI = (routeI + 1) % net.ROUTES.length
          if (routeI === 0) routeWraps++
          updateNet()
          setTimeout(startHost, routeWraps ? Math.min(2000 * routeWraps, 15000) : 0)
          return
        }
        peerOpen = false
        updateNet()
        return
      }
      netStatus = 'Network problem: ' + err.type
      renderLobby()
    })
  }
  let joinRoute = null

  // Both kinds of link end up here: a PeerJS DataConnection, or a relay link that looks like one.
  function accept (conn) {
    conn.on('data', msg => onMessage(conn, msg))
    // A direct link may still go through our TURN relay; check once ICE has settled.
    if (!conn.relayed) {
      conn.on('open', () => setTimeout(async () => {
        if (conn.open && await relay.usesRelay(conn.peerConnection)) { conn.viaTurn = true; renderLobby() }
      }, 1500))
    }
  }

  let reconnectTimer = null
  let reconnectTries = 0
  let downSince = null
  let statusTimer = null
  function reconnect () {
    if (!peer || peer.destroyed || !peer.disconnected) return
    try { peer.reconnect() } catch (e) { /* the next 'disconnected' schedules another try */ }
  }
  // The room is open once either way in works. Short blips aren't worth a message: say
  // something only if a way in is still missing after 5 s.
  function updateNet () {
    clearTimeout(statusTimer)
    if (peerOpen || mqttOnline) roomCode = code
    if (peerOpen && mqttOnline) {
      downSince = null
      netStatus = 'open'
      renderLobby()
      return
    }
    if (!downSince) downSince = Date.now()
    if (!roomCode) { netStatus = takenTries ? `Reopening room ${code}…` : 'starting'; renderLobby() }
    statusTimer = setTimeout(() => {
      if (!downSince) return
      netStatus = navigator.onLine === false
        ? 'This computer is offline. New phones can\'t join until it\'s back; players already in can keep playing.'
        : !peerOpen && !mqttOnline
          ? (roomCode
            ? 'Reconnecting… Players already in can keep playing; new phones can join once it\'s back.'
            : `Can't reach a join server or the relay yet (tried ${location.hostname}, 0.peerjs.com and the relay on ${location.hostname}). Still trying… If this doesn't clear, this network may block it: try another computer.`)
          : !peerOpen
            ? 'Direct joining is down on this network, so phones join through the encrypted relay: scan the QR code (typing the room code won\'t work).'
            : 'The relay on ' + location.hostname + ' is unreachable: phones join directly only, so a phone whose network blocks that can\'t get in.'
      renderLobby()
    }, Math.max(0, 5000 - (Date.now() - downSince)))
  }
  // Back online, or the screen woke up: try at once instead of waiting for the next retry.
  window.addEventListener('online', () => { reconnectTries = 0; reconnect() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconnect() })

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
      const p = game.join(token, name)
      if (!p) { send(conn, { t: 'full' }); return }
      if (p.kicked) { send(conn, { t: 'kicked' }); setTimeout(() => conn.close(), 200); return }
      if (p.conn && p.conn !== conn) p.conn.close()
      p.conn = conn
      conn.player = p
      const gone = () => { if (p.conn === conn) { p.conn = null; sim.setInput(p.blob, 0, 0); renderLobby() } }
      conn.on('close', gone)
      conn.on('error', gone)
      sendYou(p)
      if (game.phase === 'round' && game.hunter && game.hunter !== p) sendYou(game.hunter)   // its map gained a blob
      renderLobby()
      return
    }
    const p = conn.player
    if (!p) return
    if (msg.t === 'aim') { game.aimAt(p, Number(msg.a)); return }
    if (msg.t === 'mark') {
      const r = game.mark(p, Number(msg.a))
      if (r && !r.ok) send(p.conn, { t: 'event', kind: 'marks-full' })
      return
    }
    if (msg.t === 'net') {
      const r = game.throwNet(p, Number(msg.a))
      if (!r) return
      send(p.conn, { t: 'event', kind: 'net', held: r.held })
      sendYou(p)
      for (const q of r.players) sendYou(q)      // their phones start the countdown
      return
    }
    if (msg.t === 'shoot') {
      const ev = game.shoot(p, Number(msg.a))
      if (!ev) return
      if (ev.type === 'caught') { sendYou(ev.player); send(p.conn, { t: 'event', kind: 'caught', name: ev.player.name }) }
      else send(p.conn, { t: 'event', kind: 'bot' })
      if (game.phase !== 'round') broadcast(); else sendYou(p)
      return
    }
    if (msg.t === 'in') {
      if (p.caught || p.blob.hidden) return
      if (game.heldLeft(p.blob) > 0) return        // held by the net: moves are ignored
      const dx = Number(msg.dx), dy = Number(msg.dy)
      if (!isFinite(dx) || !isFinite(dy)) return
      const m = Math.hypot(dx, dy)
      sim.setInput(p.blob, m > 1 ? dx / m : dx, m > 1 ? dy / m : dy)
    }
  }

  function sendYou (p) { send(p.conn, Object.assign(game.viewFor(p), { map: map.id })) }

  // Change map: only between rounds. Everyone's phone follows.
  function nextMap () {
    if (game && game.phase === 'round') return
    const list = maps.list
    map = list[(list.indexOf(map) + 1) % list.length]
    sim.setMap(map)
    net.store.set('map', map.id)
    if (game) broadcast()
  }

  function broadcast () {
    for (const p of players.values()) sendYou(p)
    if (lobby) lobby.hidden = game.phase === 'round'   // the panel steps aside while a round runs
    renderLobby()
  }

  // Events from the rules, each simulation step: tick-offs go to that phone at once
  // (not to the TV, where a score jumping would give the player away).
  function onEvents (events) {
    for (const ev of events) {
      if (ev.type === 'task') sendYou(ev.player)
      else if (ev.type === 'hunter') { if (game.hunter) sendYou(game.hunter) }
      else if (ev.type === 'net') { for (const p of players.values()) sendYou(p) }   // the net has lifted
      else if (ev.type === 'end') broadcast()
    }
  }

  // 10 times a second: each hider hears only where its own blob is; the Hunter hears every blob.
  if (!demo) {
    setInterval(() => {
      for (const p of players.values()) {
        if (!p.conn) continue
        if (p === game.hunter && game.phase === 'round') { send(p.conn, game.hunterView()); continue }
        send(p.conn, {
          t: 'pos',
          x: Math.round(p.blob.x / sim.W * 1000) / 1000,
          y: Math.round(p.blob.y / sim.H * 1000) / 1000,
          hold: p.task ? Math.round(p.task.hold / sim.TASK_HOLD * 100) / 100 : 0,
          tl: Math.ceil(game.timeLeft),
          held: game.phase === 'round' ? Math.ceil(game.heldLeft(p.blob)) : 0,
        })
      }
    }, 1000 / net.POS_HZ)
  }

  function nextStep () {
    if (game.next()) broadcast()
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

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // Remove a player, between rounds only (mid-round the panel shows no names on purpose).
  const kickButton = p => `<button type="button" class="kick" data-kick="${esc(p.token)}" aria-label="Kick ${esc(p.name)}">Kick</button>`
  function kickPlayer (token) {
    const p = players.get(token)
    if (!p || !confirm(`Remove ${p.name} from this game? They won't be able to join again.`)) return
    const conn = p.conn
    if (!game.kick(token)) return
    if (conn) { send(conn, { t: 'kicked' }); setTimeout(() => conn.close(), 200) }
    broadcast()
  }

  // How a phone is linked, shown between rounds: nothing when it's direct.
  const via = conn => conn.relayed ? ' <span class="via">relay</span>' : conn.viaTurn ? ' <span class="via">TURN</span>' : ''

  function renderLobby () {
    if (!lobby) return
    if (!roomCode) {
      lobby.innerHTML = `<p class="status">${netStatus === 'starting' ? 'Opening the room…' : esc(netStatus)}</p>`
      return
    }
    const status = netStatus === 'open' ? '' : `<p class="status">${esc(netStatus)}</p>`
    const mapLine = game.phase === 'round' ? '' : `<p class="mapline">Map: <strong>${esc(map.name)}</strong> <button type="button" class="quiet" id="map">Change map <kbd>M</kbd></button></p>`
    const button = game.nextLabel() ? `<button type="button" class="next" id="next"${game.phase === 'lobby' && !game.canStart() ? ' disabled' : ''}>${esc(game.nextLabel())} <kbd>Enter</kbd></button>` : ''
    if (game.phase === 'results' || game.phase === 'over') {
      const why = { time: 'Time\'s up.', 'all-caught': 'The Hunter caught everyone.', 'all-done': 'Everyone still in finished their landmarks.', stopped: 'Stopped by the host.' }[game.endReason] || ''
      const rows = game.scoreboard().map((p, i) =>
        `<tr><td>${i + 1}</td><td>${esc(p.name)}${p === game.hunter ? ' <span class="tag">Hunter</span>' : p.caught ? ' <span class="tag">caught</span>' : ''}</td>` +
        (game.phase === 'results' ? `<td class="num">+${p.roundPts}</td>` : '') + `<td class="num">${p.score}</td><td>${kickButton(p)}</td></tr>`).join('')
      lobby.innerHTML =
        `<h2>${game.phase === 'over' ? 'Final scores' : `Round ${game.round} over`}</h2>` +
        (game.phase === 'results' ? `<p class="why">${why}</p>` : '') +
        `<table class="board"><thead><tr><th scope="col">#</th><th scope="col">Player</th>${game.phase === 'results' ? '<th scope="col" class="num">Round</th>' : ''}<th scope="col" class="num">Total</th><th scope="col"><span class="sr">Remove</span></th></tr></thead><tbody>${rows}</tbody></table>` +
        button + mapLine + status +
        `<p class="keys">Room ${roomCode}${game.phase === 'results' ? ' · G final scores now' : ''} · Q hides this panel</p>`
    } else {
      const url = net.joinUrl(roomCode, secret)
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      const inRound = game.phase === 'round'
      // Mid-round the panel shows no names: a list changing as people join or drop could hint at who is who.
      const list = inRound ? '' : '<ul>' + [...players.values()].sort((a, b) => a.order - b.order)
        .map(p => `<li${p.conn ? '' : ' class="away"'}><span class="nm">${esc(p.name)}${p.conn ? via(p.conn) : ' (away)'}</span>${kickButton(p)}</li>`).join('') + '</ul>'
      lobby.innerHTML =
        `<h2>Join on your phone</h2>` +
        `<img class="qr" alt="QR code to join room ${roomCode}" src="${qr.createDataURL(8, 2)}">` +
        `<p class="url">or go to <strong>${esc(siteAddress())}</strong> and enter</p>` +
        `<p class="code" aria-label="Room code ${roomCode.split('').join(' ')}">${roomCode}</p>` +
        `<h3>${players.size} ${players.size === 1 ? 'player' : 'players'}</h3>${list}` +
        (inRound ? '' : button + mapLine) + status +
        `<p class="keys">Q hides this panel · N starts a new room${joinRoute ? ` · join server: ${joinRoute === 'proxy' ? location.hostname : joinRoute === 'cloud' ? '0.peerjs.com' : 'local test'}` : ''}${mqttOnline ? ' · relay ready' : ''}</p>`
    }
    for (const kb of lobby.querySelectorAll('button[data-kick]')) kb.addEventListener('click', () => kickPlayer(kb.dataset.kick))
    const btn = document.getElementById('next')
    if (btn) btn.addEventListener('click', nextStep)
    const mb = document.getElementById('map')
    if (mb) mb.addEventListener('click', nextMap)
  }

  if (!demo) {
    renderLobby()
    useCode(net.store.get('host-code') || net.makeCode())
    startHost()
    window.addEventListener('pagehide', () => { if (peer) peer.destroy(); if (mqtt) mqtt.destroy() })   // frees the room id at once
  }

  function newRoom () {
    net.store.set('host-code', net.makeCode())
    net.store.set('host-secret', relay.newRoomSecret())   // a new room gets a new relay secret too
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
    reveal: '#B48AE8', hud: '#9A8E7E', out: '#6E665A', aim: '#F0D28C',
  }

  function drawFloor () {
    ctx.fillStyle = map.colours.floor
    ctx.strokeStyle = map.colours.wall
    ctx.lineWidth = 6
    roundRect(0, 0, sim.W, sim.H, 24)
    ctx.fill(); ctx.stroke()
    ctx.strokeStyle = map.colours.floorLine
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

  // Landmarks come from the map (maps.js) and are drawn by art.js.
  const drawLandmark = (lm, t) => art.draw(ctx, lm, t, map.colours.floor)
  const drawCanopy = lm => art.canopy(ctx, lm)
  const drawLabel = lm => art.label(ctx, lm, C.label)

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
    const dead = b.out || b.gone                      // caught human, or a shot bot about to leave
    if (dead) ctx.scale(1.15, 0.8)                     // flattened: a shape cue, not only grey
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2)
    ctx.fillStyle = dead ? C.out : isHuman ? C.reveal : C.blob; ctx.fill()
    ctx.beginPath(); ctx.arc(-R * 0.25, R * 0.3, R * 0.7, 0, Math.PI * 2)
    ctx.globalAlpha = 0.25; ctx.fillStyle = C.blobShade; ctx.fill(); ctx.globalAlpha = 1
    if (dead) {                                        // X eyes
      ctx.strokeStyle = C.eye; ctx.lineWidth = 2.5
      for (const sx2 of [-1, 1]) {
        const cx = sx2 * R * 0.32, cy = -R * 0.1, r2 = R * 0.16
        ctx.beginPath(); ctx.moveTo(cx - r2, cy - r2); ctx.lineTo(cx + r2, cy + r2); ctx.moveTo(cx + r2, cy - r2); ctx.lineTo(cx - r2, cy + r2); ctx.stroke()
      }
    } else {
      const ex = Math.cos(b.facing) * R * 0.38
      const ey = Math.sin(b.facing) * R * 0.38 - R * 0.12
      const px = Math.cos(b.facing + Math.PI / 2) * R * 0.3
      const py = Math.sin(b.facing + Math.PI / 2) * R * 0.3
      circle(ex + px, ey + py, R * 0.16, C.eye)
      circle(ex - px, ey - py, R * 0.16, C.eye)
    }
    ctx.restore()
    if (b.gone) tag(x, y - R - 14, 'bot')
    // Colour is never the only cue: a revealed human also gets a ring and a marker above it.
    if (isHuman) {
      ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI * 2)
      ctx.strokeStyle = C.blob; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(x - 9, y - R - 22); ctx.lineTo(x + 9, y - R - 22); ctx.lineTo(x, y - R - 10); ctx.closePath()
      ctx.fillStyle = C.blob; ctx.fill()
    }
  }

  // A small label above something in the room, on a dark pill so it reads anywhere.
  function tag (x, y, text) {
    ctx.font = '600 20px system-ui, sans-serif'
    const w = ctx.measureText(text).width + 16
    ctx.fillStyle = 'rgba(18,17,15,0.85)'
    roundRect(x - w / 2, y - 15, w, 26, 13); ctx.fill()
    ctx.fillStyle = C.blob; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y - 2)
  }

  // The Hunter's selection: a crosshair everyone can see on the TV.
  function drawAim (b, alpha) {
    const x = b.px + (b.x - b.px) * alpha
    const y = b.py + (b.y - b.py) * alpha
    const r = sim.BLOB_R + 12
    ctx.strokeStyle = C.aim; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * (r - 6), y + dy * (r - 6)); ctx.lineTo(x + dx * (r + 10), y + dy * (r + 10)) }
    ctx.stroke()
  }

  // A suspect the Hunter has marked: a thin ring and a numbered tag, so the room can follow.
  function drawMark (b, n, alpha) {
    const x = b.px + (b.x - b.px) * alpha
    const y = b.py + (b.y - b.py) * alpha
    ctx.strokeStyle = C.blob; ctx.lineWidth = 2; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.arc(x, y, sim.BLOB_R + 7, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    // Above the crosshair's top tick when the Hunter is also aiming at this blob, so they don't overlap.
    tag(x, y - sim.BLOB_R - (game.aim === b ? 46 : 22), `Suspect ${n}`)
  }

  // The Hunter's net: a mesh over the circle with the seconds left in the middle. Shape and a
  // number, never colour alone. It catches nobody, so it looks the same whoever is under it.
  function drawNet (n) {
    const left = n.until - world.time
    if (left <= 0) return
    ctx.save()
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(18,17,15,0.35)'; ctx.fill()
    ctx.clip()
    ctx.strokeStyle = 'rgba(232,223,200,0.55)'; ctx.lineWidth = 2
    ctx.beginPath()
    for (let d = -n.r * 2; d <= n.r * 2; d += 22) {
      ctx.moveTo(n.x + d - n.r, n.y - n.r); ctx.lineTo(n.x + d + n.r, n.y + n.r)
      ctx.moveTo(n.x + d + n.r, n.y - n.r); ctx.lineTo(n.x + d - n.r, n.y + n.r)
    }
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = C.blob; ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.stroke()
    tag(n.x, n.y - n.r - 18, `Net · ${Math.ceil(left)} s`)
  }

  // A shot: a ring that spreads out, and what it hit.
  function drawShot (shot) {
    const age = world.time - shot.at
    if (age > 2.5) return
    const r = 24 + Math.min(age, 0.6) * 120
    ctx.strokeStyle = C.aim; ctx.lineWidth = 4; ctx.globalAlpha = Math.max(0, 1 - age / 2.5)
    ctx.beginPath(); ctx.arc(shot.x, shot.y, r, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    if (shot.kind === 'caught') tag(shot.x, shot.y - sim.BLOB_R - 40, `Caught: ${shot.name}`)
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
      while (acc >= STEP) { sim.step(world, STEP); if (game) onEvents(game.step(STEP)); acc -= STEP }
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
    const order = world.blobs.filter(b => !b.hidden).sort((a, b) => a.y - b.y)
    const alpha = paused ? 1 : acc / STEP   // draw between the last two steps (smooth at 120 Hz)
    const ended = game && (game.phase === 'results' || game.phase === 'over')
    for (const b of order) drawBlob(b, reveal || ended, alpha)
    for (const lm of world.landmarks) drawCanopy(lm)
    for (const lm of world.landmarks) drawLabel(lm)
    if (game) {
      if (game.phase === 'round' && game.net) drawNet(game.net)
      if (game.phase === 'round') for (const [b, n] of game.marks) if (!b.hidden) drawMark(b, n, alpha)
      if (game.aim && game.phase === 'round') drawAim(game.aim, alpha)
      if (game.phase === 'round') for (const shot of game.shotsFired) drawShot(shot)   // after the round, the name tags take over
      // End of round: everyone sees who was who.
      if (ended) for (const p of players.values()) if (!p.blob.hidden) tag(p.blob.x, p.blob.y - sim.BLOB_R - 40, p.name)
    }

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
    if (game && game.phase === 'round') {
      // Round bar: big enough to read from the sofa.
      const t = Math.ceil(game.timeLeft)
      const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
      const shots = '●'.repeat(game.shots) + '○'.repeat(round.MAX_SHOTS - game.shots)
      const shotState = game.lockLeft > 0 ? ` · locked ${Math.ceil(game.lockLeft)} s`
        : game.shots < round.MAX_SHOTS ? ` · next in ${Math.ceil(round.SHOT_RECHARGE - game.recharge)} s` : ''
      const big = Math.max(18, Math.round(ch * 0.034))
      ctx.font = `600 ${big}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = C.blob
      const text = `Round ${game.round} · Hunter: ${game.hunter ? game.hunter.name : ''} · ${clock} · ${shots} ${game.shots} ${game.shots === 1 ? 'shot' : 'shots'}${shotState} · ${game.netUsed ? 'net used' : 'net ready'}`
      const w = ctx.measureText(text).width + big * 1.2
      ctx.fillStyle = 'rgba(18,17,15,0.85)'
      ctx.fillRect(cw / 2 - w / 2, oy + 10, w, big * 1.6)
      ctx.fillStyle = t <= 10 ? C.aim : C.blob
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cw / 2, oy + 10 + big * 0.8)
    }
    if (showHelp) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(game
        ? 'Enter start / next · E end round · M map · Space pause · F full screen · Q panel · H hide this line'
        : 'Space pause · R reveal humans (testing only) · M map · F full screen · H hide this line', cw / 2, ch - 4)
    }
  }

  window.addEventListener('keydown', e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === ' ') { paused = !paused; e.preventDefault() }
    else if (k === 'r' && !game) reveal = !reveal   // demo only: in a real game it would be cheating
    else if (k === 'h') showHelp = !showHelp
    else if (k === 'm') nextMap()
    else if (k === 'q' && lobby) lobby.hidden = !lobby.hidden
    else if (k === 'enter' && game && e.target.tagName !== 'BUTTON') nextStep()
    else if (k === 'e' && game && game.phase === 'round' && confirm('End this round now?')) { game.endRound(); broadcast() }
    else if (k === 'g' && game && game.phase === 'results') { game.finish(); broadcast() }
    else if (k === 'n' && lobby && confirm('Start a new room? Everyone will need to join again.')) newRoom()
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
    }
  })

  window.__actNatural = { world, players, game }   // for automated tests
  requestAnimationFrame(frame)
})()
