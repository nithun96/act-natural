// Act Natural: the rules of a game: lobby, rounds, the Hunter, shooting and scores.
// No drawing and no network here. The TV (host.js) calls these and tells the phones.
(function () {
  'use strict'
  const { sim } = window.ActNatural

  const ROUND_TIME = 90        // seconds
  const SHOTS = 3
  const CATCH_POINTS = 3
  const MAX_PLAYERS = 20
  const BOT_REVEAL_TIME = 1.5  // a shot bot shows "bot" this long, then leaves the room

  function create (world) {
    const g = {
      phase: 'lobby',           // lobby → round → results → round … → over
      round: 0,
      players: new Map(),       // token → player
      hunter: null,
      hunted: new Set(),        // tokens that have been the Hunter this game
      timeLeft: 0,
      shots: 0,
      aliases: new Map(),       // alias → blob, shuffled each round so the Hunter's ids say nothing
      aim: null,                // the blob the Hunter has selected
      shotsFired: [],           // { x, y, kind: 'caught' | 'bot', name, at } for the TV
      endReason: null,
    }

    const ordered = () => [...g.players.values()].sort((a, b) => a.order - b.order)
    const online = () => ordered().filter(p => p.conn)
    const hiders = () => [...g.players.values()].filter(p => p !== g.hunter)
    const ROUNDLESS = new Set(['lobby', 'over'])

    g.join = (token, name) => {
      let p = g.players.get(token)
      if (!p) {
        if (g.players.size >= MAX_PLAYERS) return null
        p = { token, name, blob: sim.addHuman(world), conn: null, order: g.players.size, score: 0, roundPts: 0, caught: false, task: null }
        if (g.phase === 'round') { p.task = sim.dealTasks(); refreshAliases() }   // joining mid-round: hide right away
        g.players.set(token, p)
      }
      p.name = name
      return p
    }

    g.canStart = () => online().length >= 2

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
        p.task = p === h ? null : sim.dealTasks()
      }
      h.blob.hidden = true                // the Hunter has no blob
      sim.setInput(h.blob, 0, 0)
      refreshAliases()
      g.timeLeft = ROUND_TIME
      g.shots = SHOTS
      g.aim = null
      g.shotsFired = []
      g.endReason = null
      g.phase = 'round'
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

    function endRound (reason) {
      g.phase = 'results'
      g.endReason = reason
      g.aim = null
      for (const p of g.players.values()) if (p.task) p.task.hold = 0
    }
    g.endRound = () => { if (g.phase === 'round') endRound('stopped') }

    // Every player online has been the Hunter: the game is over after this round.
    g.everyoneHunted = () => online().every(p => g.hunted.has(p.token))

    // The host's one button: start, next round, final scores, new game.
    g.next = () => {
      if (g.phase === 'lobby') return g.startRound()
      if (g.phase === 'results') {
        if (g.everyoneHunted()) { g.phase = 'over'; g.hunter = null; return true }
        return g.startRound()
      }
      if (g.phase === 'over') { g.newGame(); return true }
      return false
    }
    g.finish = () => { if (g.phase === 'results') { g.phase = 'over'; g.hunter = null } }

    g.newGame = () => {
      for (const p of g.players.values()) { p.score = 0; p.roundPts = 0; p.caught = false; p.task = null }
      g.hunted.clear()
      g.round = 0
      g.hunter = null
      g.phase = 'lobby'
      sim.resetRoom(world)
    }

    g.nextLabel = () => {
      if (g.phase === 'lobby') return g.canStart() ? 'Start round 1' : 'Waiting for 2 players'
      if (g.phase === 'results') return g.everyoneHunted() ? 'Final scores' : `Start round ${g.round + 1}`
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
      for (const p of hiders()) {
        if (p.caught) continue
        const pts = sim.stepTask(p.task, p.blob, dt)
        if (pts) { p.score += pts; p.roundPts += pts; events.push({ type: 'task', player: p }) }
      }
      if (g.timeLeft <= 0) { g.timeLeft = 0; endRound('time'); events.push({ type: 'end' }) }
      return events
    }

    // Removing a bot must not shuffle what the Hunter is looking at mid-aim: keep aliases, drop the gone ones.
    function refreshAliasesKeepAim () {
      for (const [a, b] of g.aliases) if (!world.blobs.includes(b)) g.aliases.delete(a)
    }

    g.aimAt = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter) return
      const b = g.aliases.get(alias)
      g.aim = b && !b.out && !b.gone ? b : null
    }

    // A shot. Returns an event, or null if it didn't count (not the Hunter, no shots, gone blob).
    g.shoot = (p, alias) => {
      if (g.phase !== 'round' || p !== g.hunter || g.shots <= 0) return null
      const b = g.aliases.get(alias)
      if (!b || b.out || b.gone || b.hidden) return null
      g.shots--
      g.aim = null
      const victim = hiders().find(q => q.blob === b)
      let ev
      if (victim) {
        b.out = true
        sim.setInput(b, 0, 0)
        victim.caught = true
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
        ev = { type: 'bot' }
      }
      if (hiders().every(q => q.caught)) endRound('all-caught')
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
        shots: isHunter ? g.shots : undefined,
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
      return { t: 'all', b, tl: Math.ceil(g.timeLeft), aim: aliasOf(g.aim) }
    }
    function aliasOf (blob) {
      if (!blob) return null
      for (const [a, b] of g.aliases) if (b === blob) return a
      return null
    }

    g.scoreboard = () => [...g.players.values()].sort((a, b) => b.score - a.score || a.order - b.order)

    return g
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, {
    round: { create, ROUND_TIME, SHOTS, CATCH_POINTS, MAX_PLAYERS },
  })
})()
