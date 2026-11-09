// Act Natural: the rules of a game: lobby, rounds, the Hunter, shooting and scores.
// No drawing and no network here. The TV (host.js) calls these and tells the phones.
(function () {
  'use strict'
  const { sim } = window.ActNatural

  const ROUND_TIME = 90        // seconds
  const START_SHOTS = 1        // the Hunter starts each round with one shot…
  const MAX_SHOTS = 3          // …and can store up to three
  const SHOT_RECHARGE = 20     // seconds per new shot, while below the maximum
  const MISS_LOCK = 5          // seconds the Hunter can't shoot after hitting a bot
  const NET_RADIUS = 130       // world units: the net covers a circle a bit bigger than a landmark
  const NET_HOLD = 8           // seconds everything under the net is held
  const MAX_MARKS = 3          // suspects the Hunter can mark at once
  const CATCH_POINTS = 3
  const MAX_PLAYERS = 20
  const BOT_REVEAL_TIME = 1.5  // a shot bot shows "bot" this long, then leaves the room
  const PATH_EVERY = 0.1       // seconds between recorded points of each hider's path, for the replay
  const AWAY_GRACE = 10        // seconds a hider can be disconnected and still count as in the round

  function create (world) {
    const g = {
      phase: 'lobby',           // lobby → round → results → round … → over
      round: 0,
      players: new Map(),       // token → player
      hunter: null,
      hunted: new Set(),        // tokens that have been the Hunter this game
      kicked: new Set(),        // tokens the host removed; they can't join again this session
      timeLeft: 0,
      shots: 0,
      recharge: 0,              // seconds towards the next shot
      lockLeft: 0,              // seconds until the Hunter can shoot again after a miss
      marks: new Map(),         // blob → mark number 1–3, shown over the blob on the TV
      aliases: new Map(),       // alias → blob, shuffled each round so the Hunter's ids say nothing
      aim: null,                // the blob the Hunter has selected
      shotsFired: [],           // { x, y, kind: 'caught' | 'bot', name, at } for the TV
      endReason: null,
      onChange: null,           // the TV sets this to save a snapshot (scores, kicks…) when they change
    }
    const changed = () => { if (g.onChange) g.onChange() }

    const ordered = () => [...g.players.values()].sort((a, b) => a.order - b.order)
    const online = () => ordered().filter(p => p.conn)
    const hiders = () => [...g.players.values()].filter(p => p !== g.hunter)
    const ROUNDLESS = new Set(['lobby', 'over'])

    g.join = (token, name) => {
      if (g.kicked.has(token)) return { kicked: true }
      let p = g.players.get(token)
      if (!p) {
        if (g.players.size >= MAX_PLAYERS) return null
        p = { token, name, blob: sim.addHuman(world), conn: null, order: g.players.size, score: 0, roundPts: 0, caught: false, task: null }
        if (g.phase === 'round') { p.task = sim.dealTasks(); appendAliases(); p.path = []; p.pathEvents = [] }   // joining mid-round: hide right away
        g.players.set(token, p)
      }
      p.name = name
      changed()
      return p
    }

    g.canStart = () => online().length >= 2

    // The host removes a player (between rounds only). Their blob leaves the room and the
    // phone can't join again in this room (kicks survive a TV reload; a new room clears them).
    g.kick = (token) => {
      const p = g.players.get(token)
      if (!p || g.phase === 'round') return null
      g.players.delete(token)
      g.hunted.delete(token)
      g.kicked.add(token)
      world.blobs = world.blobs.filter(b => b !== p.blob)
      if (g.hunter === p) g.hunter = null
      changed()
      return p
    }

    // Hunters go in join order: the first player who hasn't hunted yet this game.
    g.startRound = () => {
      const list = online()
      if (list.length < 2) return false
      let h = list.find(p => !g.hunted.has(p.token))
      if (!h) { g.hunted.clear(); h = list[0] }
      g.hunter = h
      g.hunted.add(h.token)
      g.round++
      sim.resetRoom(world)
      for (const p of g.players.values()) {
        p.roundPts = 0
        p.caught = false
        p.awaySince = null
        p.task = p === h ? null : sim.dealTasks()
        p.path = []              // [t, x, y] every PATH_EVERY seconds, for the replay after the round
        p.pathEvents = []        // { t, x, y, kind: 'task' | 'caught', n }
      }
      h.blob.hidden = true                // the Hunter has no blob
      sim.setInput(h.blob, 0, 0)
      refreshAliases()
      g.timeLeft = ROUND_TIME
      g.pathClock = 0
      g.shots = START_SHOTS
      g.recharge = 0
      g.lockLeft = 0
      g.marks = new Map()
      g.aim = null
      g.shotsFired = []
      g.endReason = null
      releaseNet()
      g.netUsed = false
      g.phase = 'round'
      changed()
      return true
    }

    function refreshAliases () {
      const blobs = world.blobs.filter(b => !b.hidden)
      for (let i = blobs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [blobs[i], blobs[j]] = [blobs[j], blobs[i]]
      }
      g.aliases = new Map(blobs.map((b, i) => [i, b]))
      g.aim = null
    }
    g.refreshAliases = refreshAliases

    // New blobs mid-round (a phone joins, and bots are topped up with it) get new numbers at the
    // end, in random order among themselves. Existing numbers, the aim and the marks stay as they
    // are, so the Hunter never ends up pointing at a different blob than the one they chose.
    function appendAliases () {
      const known = new Set(g.aliases.values())
      const fresh = world.blobs.filter(b => !b.hidden && !known.has(b))
      for (let i = fresh.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fresh[i], fresh[j]] = [fresh[j], fresh[i]]
      }
      let next = g.aliases.size ? Math.max(...g.aliases.keys()) + 1 : 0
      for (const b of fresh) g.aliases.set(next++, b)
    }

    function endRound (reason) {
      g.phase = 'results'
      g.endReason = reason
      g.aim = null
      g.marks = new Map()
      g.lockLeft = 0
      releaseNet()
      for (const p of g.players.values()) if (p.task) p.task.hold = 0
      changed()
    }
    g.endRound = () => { if (g.phase === 'round') endRound('stopped') }

    // Every player online has been the Hunter: the game is over after this round. Nobody online
    // (e.g. just after the TV reloaded, before the phones are back) doesn't count as everyone.
    g.everyoneHunted = () => { const list = online(); return list.length > 0 && list.every(p => g.hunted.has(p.token)) }

    // The host's one button: start, next round, final scores, new game.
    g.next = () => {
      if (g.phase === 'lobby') return g.startRound()
      if (g.phase === 'results') {
        if (g.everyoneHunted()) { g.phase = 'over'; g.hunter = null; changed(); return true }
        return g.startRound()
      }
      if (g.phase === 'over') { g.newGame(); return true }
      return false
    }
    g.finish = () => { if (g.phase === 'results') { g.phase = 'over'; g.hunter = null; changed() } }

    g.newGame = () => {
      for (const p of g.players.values()) { p.score = 0; p.roundPts = 0; p.caught = false; p.task = null }
      g.hunted.clear()
      g.round = 0
      g.hunter = null
      g.phase = 'lobby'
      sim.resetRoom(world)
      changed()
    }

    g.nextLabel = () => {
      if (g.phase === 'lobby') return g.canStart() ? 'Start round 1' : 'Waiting for 2 players'
      if (g.phase === 'results') return g.everyoneHunted() ? 'Final scores' : g.canStart() ? `Start round ${g.round + 1}` : 'Waiting for 2 players'
      if (g.phase === 'over') return 'New game'
      return ''
    }

    // Returns events for the TV to pass on: { type: 'task' | 'caught' | 'bot' | 'end', player }
    g.step = (dt) => {
      const events = []
      // Shot bots leave the room after a moment.
      const before = world.blobs.length
      world.blobs = world.blobs.filter(b => !(b.gone && world.time - b.goneAt > BOT_REVEAL_TIME))
      if (world.blobs.length !== before && g.phase === 'round') refreshAliasesKeepAim()
      if (g.phase !== 'round') return events
      g.timeLeft -= dt
      // Shots come back one at a time while the Hunter has fewer than the maximum.
      if (g.shots < MAX_SHOTS) {
        g.recharge += dt
        if (g.recharge >= SHOT_RECHARGE) { g.shots++; g.recharge -= SHOT_RECHARGE; events.push({ type: 'hunter' }) }
      }
      if (g.shots >= MAX_SHOTS) g.recharge = 0
      if (g.lockLeft > 0) {
        g.lockLeft = Math.max(0, g.lockLeft - dt)
        if (g.lockLeft === 0) events.push({ type: 'hunter' })
      }
      // The net lifts after NET_HOLD. Each blob under it was given its own release time a moment
      // after that (see throwNet), so they don't all set off together.
      if (g.net && world.time >= g.net.until + 0.5) { g.net = null; events.push({ type: 'net' }) }
      for (const p of hiders()) {
        if (p.caught) continue
        if (heldNow(p.blob)) { if (p.task) p.task.hold = 0; continue }   // held: no task progress
        const pts = sim.stepTask(p.task, p.blob, dt)
        if (pts) {
          p.score += pts; p.roundPts += pts; events.push({ type: 'task', player: p }); changed()
          if (p.pathEvents) p.pathEvents.push({ t: roundTime(), x: p.blob.x, y: p.blob.y, kind: 'task', n: p.task.done })
        }
      }
      // Each hider's path, for the replay after the round. Only the TV keeps it; it is shown once
      // the round is over and everyone can see who was who anyway.
      g.pathClock += dt
      if (g.pathClock >= PATH_EVERY) {
        g.pathClock -= PATH_EVERY
        for (const p of hiders()) if (p.path && !p.caught) recordPoint(p)
      }
      // How long each hider has been disconnected, so a short drop-out (a reload, a network
      // switch) doesn't end the round, but a phone that has left doesn't hold it up either.
      for (const p of hiders()) {
        if (p.conn) p.awaySince = null
        else if (p.awaySince == null) p.awaySince = world.time
      }
      if (g.timeLeft <= 0) { g.timeLeft = 0; endRound('time'); events.push({ type: 'end' }) }
      else {
        const reason = endedEarly()
        if (reason) { endRound(reason); events.push({ type: 'end' }) }
      }
      return events
    }

    const roundTime = () => Math.round((ROUND_TIME - g.timeLeft) * 100) / 100
    function recordPoint (p) { p.path.push([roundTime(), Math.round(p.blob.x), Math.round(p.blob.y)]) }

    // Hiders who still count: not caught, and connected or only just dropped out.
    const stillIn = () => hiders().filter(p => !p.caught && (p.conn || p.awaySince == null || world.time - p.awaySince < AWAY_GRACE))

    // Why the round should end before the clock, or null. 'all-caught': the Hunter has caught at
    // least one hider and nobody else still counts (players who have left don't keep it running).
    // 'all-done': every hider who still counts has finished all three landmarks. (Shots now come
    // back over time, so running out of them no longer matters.)
    function endedEarly () {
      const still = stillIn()
      if (still.length === 0) return hiders().some(p => p.caught) ? 'all-caught' : null
      return still.every(p => p.task && p.task.done >= p.task.tasks.length) ? 'all-done' : null
    }

    // Removing a bot must not shuffle what the Hunter is looking at mid-aim: keep aliases, drop the gone ones.
    function refreshAliasesKeepAim () {
      for (const [a, b] of g.aliases) if (!world.blobs.includes(b)) g.aliases.delete(a)
      for (const b of g.marks.keys()) if (!world.blobs.includes(b)) g.marks.delete(b)
    }

    // ---- The net: a delay, never a catch ----
    // Once per round the Hunter throws it over a blob. Every blob inside the circle at that moment,
    // bot or human, is held still for NET_HOLD seconds; hiders under it lose their landmark progress.
    // Nobody is caught and nothing is revealed. Each blob gets its own release a fraction later
    // (0.05–0.3 s, the same reaction delay bots use when they set off), the same for bots and humans.
    const heldNow = b => !!b.heldUntil && b.heldUntil > world.time
    g.heldLeft = b => heldNow(b) ? b.heldUntil - world.time : 0
    function releaseNet () {
      for (const b of world.blobs) b.heldUntil = 0
      g.net = null
    }
    g.throwNet = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter || g.netUsed) return null
      const centre = g.aliases.get(alias)
      if (!centre || centre.hidden || centre.gone) return null
      const x = centre.x, y = centre.y, until = world.time + NET_HOLD
      const held = []
      for (const b of world.blobs) {
        if (b.hidden || b.gone || b.out) continue
        if (Math.hypot(b.x - x, b.y - y) > NET_RADIUS) continue
        b.heldUntil = until + sim.rand(0.05, 0.3)
        sim.setInput(b, 0, 0)
        b.vx = b.vy = 0
        held.push(b)
      }
      for (const q of hiders()) if (held.includes(q.blob) && q.task) q.task.hold = 0
      g.net = { x, y, r: NET_RADIUS, until, at: world.time }
      g.netUsed = true
      return { held: held.length, players: hiders().filter(q => held.includes(q.blob)) }
    }

    // Mark or unmark a suspect. Marks take the lowest free number 1–3. Returns
    // { ok: true, marked } or { ok: false, reason: 'full' }, or null if it didn't count.
    g.mark = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter) return null
      const b = g.aliases.get(alias)
      if (!b || b.out || b.gone || b.hidden) return null
      if (g.marks.has(b)) { g.marks.delete(b); return { ok: true, marked: false } }
      if (g.marks.size >= MAX_MARKS) return { ok: false, reason: 'full' }
      const used = new Set(g.marks.values())
      let n = 1
      while (used.has(n)) n++
      g.marks.set(b, n)
      return { ok: true, marked: true, n }
    }

    g.aimAt = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter) return
      const b = g.aliases.get(alias)
      g.aim = b && !b.out && !b.gone ? b : null
    }

    // A shot. Returns an event, or null if it didn't count (not the Hunter, no shots, gone blob).
    g.shoot = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter || g.shots <= 0 || g.lockLeft > 0) return null
      const b = g.aliases.get(alias)
      if (!b || b.out || b.gone || b.hidden) return null
      g.shots--
      g.aim = null
      g.marks.delete(b)
      const victim = hiders().find(q => q.blob === b)
      let ev
      if (victim) {
        b.out = true
        sim.setInput(b, 0, 0)
        victim.caught = true
        if (victim.path) { recordPoint(victim); victim.pathEvents.push({ t: roundTime(), x: b.x, y: b.y, kind: 'caught' }) }
        if (victim.task) victim.task.hold = 0
        p.score += CATCH_POINTS
        p.roundPts += CATCH_POINTS
        g.shotsFired.push({ x: b.x, y: b.y, kind: 'caught', name: victim.name, at: world.time })
        ev = { type: 'caught', player: victim }
      } else {
        b.gone = true
        b.goneAt = world.time
        b.driver = null
        sim.setInput(b, 0, 0)
        g.shotsFired.push({ x: b.x, y: b.y, kind: 'bot', at: world.time })
        g.lockLeft = MISS_LOCK
        ev = { type: 'bot' }
      }
      const reason = endedEarly()
      if (reason) endRound(reason)
      return ev
    }

    // What one phone is told about the game (never anything about other players' blobs).
    g.viewFor = (p) => {
      const isHunter = p === g.hunter && !ROUNDLESS.has(g.phase)
      return {
        t: 'you',
        phase: g.phase,
        role: isHunter ? 'hunter' : 'hider',
        name: p.name,
        round: g.round,
        hunter: g.hunter && !ROUNDLESS.has(g.phase) ? g.hunter.name : null,
        tasks: p.task ? p.task.tasks : [],
        done: p.task ? p.task.done : 0,
        score: p.score,
        roundPts: p.roundPts,
        caught: p.caught,
        held: !isHunter && g.phase === 'round' ? Math.ceil(g.heldLeft(p.blob)) : 0,
        netReady: isHunter ? g.phase === 'round' && !g.netUsed : undefined,
        shots: isHunter ? g.shots : undefined,
        maxShots: isHunter ? MAX_SHOTS : undefined,
        timeLeft: Math.ceil(g.timeLeft),
        endReason: g.endReason,
        last: g.phase === 'results' && g.everyoneHunted(),
        rank: rankOf(p),
        players: g.players.size,
      }
    }

    function rankOf (p) {
      const list = [...g.players.values()].sort((a, b) => b.score - a.score)
      return list.findIndex(q => q.score === p.score) + 1
    }

    // The Hunter's map: every blob still in play, under this round's aliases. Kind is never sent.
    g.hunterView = () => {
      const b = []
      for (const [alias, blob] of g.aliases) {
        b.push([alias, Math.round(blob.x / sim.W * 1000) / 1000, Math.round(blob.y / sim.H * 1000) / 1000, blob.out ? 1 : blob.gone ? 2 : 0])
      }
      const marks = []
      for (const [blob, n] of g.marks) { const a = aliasOf(blob); if (a != null) marks.push([a, n]) }
      return {
        t: 'all', b, tl: Math.ceil(g.timeLeft), aim: aliasOf(g.aim), marks,
        shots: g.shots, maxShots: MAX_SHOTS,
        recharge: g.shots >= MAX_SHOTS ? 1 : Math.round(g.recharge / SHOT_RECHARGE * 100) / 100,
        lock: Math.ceil(g.lockLeft),
        netReady: !g.netUsed,
        net: g.net && world.time < g.net.until
          ? { x: Math.round(g.net.x / sim.W * 1000) / 1000, y: Math.round(g.net.y / sim.H * 1000) / 1000, r: g.net.r, left: Math.ceil(g.net.until - world.time) }
          : null,
      }
    }
    function aliasOf (blob) {
      if (!blob) return null
      for (const [a, b] of g.aliases) if (b === blob) return a
      return null
    }

    // The replay after a round: each hider's path and what happened on it. Hiders who joined
    // late or came back after a TV reload may have none.
    g.replay = () => ({
      length: Math.max(0.1, ROUND_TIME - Math.max(0, g.timeLeft)),
      paths: hiders().filter(p => p.path && p.path.length > 1).sort((a, b) => a.order - b.order)
        .map(p => ({ name: p.name, order: p.order, points: p.path, events: p.pathEvents, caught: p.caught })),
    })

    g.scoreboard = () => [...g.players.values()].sort((a, b) => b.score - a.score || a.order - b.order)

    // ---- Surviving a TV reload ----
    // A small, plain snapshot of the game: who is in, scores, who has hunted, kicks, the round.
    // Nothing about blobs, positions or timers: those can't be carried over sensibly.
    g.snapshot = () => ({
      v: 1,
      phase: g.phase,
      round: g.round,
      endReason: g.endReason,
      hunter: g.hunter ? g.hunter.token : null,
      hunted: [...g.hunted],
      kicked: [...g.kicked],
      players: ordered().map(p => ({ token: p.token, name: p.name, order: p.order, score: p.score, roundPts: p.roundPts, caught: p.caught })),
    })

    // Back from a snapshot, on a fresh TV page. Players come back known but offline (no link):
    // a phone that rejoins with its token gets its record. A round that was running when the TV
    // reloaded can't be resumed (the blobs and the clock are gone), so it ends there: the room
    // shows that round's results, with the points already scored kept, and the host presses Next.
    // That round's Hunter counts as having hunted.
    g.restore = (s) => {
      if (!s || s.v !== 1 || !Array.isArray(s.players)) return false
      const str = (x, n) => String(x == null ? '' : x).slice(0, n)
      const num = x => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0)
      for (const q of s.players.slice(0, MAX_PLAYERS)) {
        const token = str(q && q.token, 64)
        const name = str(q && q.name, 20)
        if (!token || !name || g.players.has(token)) continue
        g.players.set(token, { token, name, blob: sim.addHuman(world), conn: null, order: num(q.order), score: num(q.score), roundPts: num(q.roundPts), caught: !!q.caught, task: null })
      }
      for (const t of Array.isArray(s.kicked) ? s.kicked : []) g.kicked.add(str(t, 64))
      for (const t of Array.isArray(s.hunted) ? s.hunted : []) if (g.players.has(str(t, 64))) g.hunted.add(str(t, 64))
      g.round = num(s.round)
      if (g.round === 0 || s.phase === 'lobby') {
        g.phase = 'lobby'
      } else {
        g.phase = s.phase === 'over' ? 'over' : 'results'
        g.endReason = s.phase === 'round' ? 'reload' : s.endReason ? str(s.endReason, 20) : null
        g.hunter = g.phase === 'results' ? g.players.get(str(s.hunter, 64)) || null : null
        if (g.hunter) g.hunter.blob.hidden = true      // as at the end of a round: the Hunter has no blob
      }
      return true
    }

    return g
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, {
    round: { create, AWAY_GRACE, ROUND_TIME, START_SHOTS, MAX_SHOTS, SHOT_RECHARGE, MISS_LOCK, NET_RADIUS, NET_HOLD, MAX_MARKS, CATCH_POINTS, MAX_PLAYERS },
  })
})()
