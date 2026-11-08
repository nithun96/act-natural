// Act Natural: the simulation. Shared by the host (and, later, nothing else needs it:
// phones only send input). No DOM here, so it can be tested on its own.
(function () {
  'use strict'

  const W = 1600
  const H = 900
  const BLOB_R = 18
  const SPEED = 90                // world units per second, bots and humans alike
  const MARGIN = 40               // blobs stay this far from the walls
  const STICK_DEADZONE = 0.3      // joystick deflection below this = stand still
  const INPUT_TIMEOUT = 0.5       // seconds without input before a human stops
  const LANDMARK_CHANCE = 0.4
  const LANDMARK_JITTER = 55      // bots aim for a point near a landmark, not its centre

  // The current map's landmarks (maps.js). The array is changed in place by setMap, so
  // everything holding it (the world, the phone's map) sees the new map at once.
  const LANDMARKS = []
  let mapId = null
  function setMap (map) {
    LANDMARKS.length = 0
    for (const lm of map.landmarks) LANDMARKS.push(lm)
    mapId = map.id
  }
  setMap(window.ActNatural.maps.list[0])

  const rand = (a, b) => a + Math.random() * (b - a)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

  function randomPoint () {
    return { x: rand(MARGIN, W - MARGIN), y: rand(MARGIN, H - MARGIN) }
  }

  function nearLandmark (lm) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * LANDMARK_JITTER
    return { x: clamp(lm.x + Math.cos(a) * r, MARGIN, W - MARGIN), y: clamp(lm.y + Math.sin(a) * r, MARGIN, H - MARGIN) }
  }

  // The bot rule from the brief: pick a target, walk to it, pause 0.5–3 s, repeat.
  function pickTarget () {
    if (Math.random() < LANDMARK_CHANCE) return nearLandmark(LANDMARKS[Math.floor(Math.random() * LANDMARKS.length)])
    return randomPoint()
  }

  function makeBlob (id, kind) {
    const p = randomPoint()
    return {
      id, kind,                     // id is a plain number, so it never gives the kind away
      x: p.x, y: p.y, px: p.x, py: p.y, vx: 0, vy: 0,
      facing: Math.random() * Math.PI * 2,
      walkPhase: Math.random() * 10,
      driver: null,               // set for bots and fake humans
      // human state
      input: { dx: 0, dy: 0, age: Infinity },
      name: null, out: false,
    }
  }

  function insertRandom (blobs, b) {
    blobs.splice(Math.floor(Math.random() * (blobs.length + 1)), 0, b)
  }

  // Keep max(16, humans × 2) bots. Bots are only ever added, never taken away mid-game.
  function topUpBots (world) {
    const humans = world.blobs.filter(b => b.kind === 'human').length
    let bots = world.blobs.length - humans
    while (bots < Math.max(16, humans * 2)) {
      const b = makeBlob(world.nextId++, 'bot')
      b.driver = makeDriver()
      insertRandom(world.blobs, b)
      bots++
    }
  }

  function addHuman (world) {
    const b = makeBlob(world.nextId++, 'human')
    insertRandom(world.blobs, b)
    topUpBots(world)
    return b
  }

  function createWorld ({ humans = 0 } = {}) {
    const world = { w: W, h: H, time: 0, blobs: [], landmarks: LANDMARKS, nextId: 0 }
    for (let i = 0; i < humans; i++) addHuman(world)
    topUpBots(world)
    return world
  }

  // A human's joystick: direction only. Above the deadzone they move at exactly bot speed.
  function setInput (blob, dx, dy) {
    blob.input.dx = dx
    blob.input.dy = dy
    blob.input.age = 0
  }

  // ---- The wanderer: one "virtual thumb" that drives bots and fake humans alike ----
  // It follows the bot rule (pick a target, walk, pause 0.5–3 s) but only through the
  // joystick, 15 times a second, the way a phone will: a short reaction delay before
  // setting off, a heading that wobbles and drifts so paths curve a little, and now and
  // then a hesitation mid-walk. Bots and fake humans run the same code, so in the demo
  // nothing can tell them apart; real players are the test from step 2 on.
  const INPUT_HZ = 15
  const ARRIVE = 10

  function makeDriver () {
    return {
      target: null, pause: rand(0, 2), react: 0, clock: Math.random() / INPUT_HZ,
      drift: 0, driftRate: 0, hesitateIn: rand(2, 10),
    }
  }

  function driveTick (d, b) {
    const tick = 1 / INPUT_HZ
    if (d.pause > 0) {
      d.pause -= tick
      if (d.pause <= 0) {
        if (!d.target) d.target = pickTarget()
        d.react = rand(0.05, 0.3)
        d.drift = rand(-0.35, 0.35)          // start a little off the straight line…
        d.driftRate = rand(-0.25, 0.25)      // …and curve back or away while walking
      }
      if (b.input.dx || b.input.dy) setInput(b, 0, 0)   // a released stick sends one zero
      return
    }
    if (d.react > 0) { d.react -= tick; return }
    if (!d.target) d.target = pickTarget()
    const dx = d.target.x - b.x
    const dy = d.target.y - b.y
    const dist = Math.hypot(dx, dy)
    if (dist < ARRIVE) {
      setInput(b, 0, 0)
      d.target = null
      d.pause = rand(0.5, 3)
      return
    }
    d.hesitateIn -= tick
    if (d.hesitateIn <= 0) {             // stop for a moment, keep the same target
      d.hesitateIn = rand(4, 14)
      d.pause = rand(0.2, 0.9)
      setInput(b, 0, 0)
      return
    }
    // Drift fades as the target gets close, so the blob still arrives.
    d.drift += d.driftRate * tick
    d.drift = clamp(d.drift, -0.5, 0.5)
    const fade = Math.min(1, dist / 160)
    const a = Math.atan2(dy, dx) + d.drift * fade + rand(-0.06, 0.06)
    const mag = rand(0.7, 1)
    setInput(b, Math.cos(a) * mag, Math.sin(a) * mag)
  }

  function drive (b, dt) {
    const d = b.driver
    d.clock -= dt
    while (d.clock <= 0) { d.clock += 1 / INPUT_HZ; driveTick(d, b) }
  }

  function stepHuman (b, dt) {
    const inp = b.input
    inp.age += dt
    const mag = Math.hypot(inp.dx, inp.dy)
    if (b.out || inp.age > INPUT_TIMEOUT || mag < STICK_DEADZONE) {
      b.vx = b.vy = 0
      return
    }
    b.vx = inp.dx / mag * SPEED
    b.vy = inp.dy / mag * SPEED
  }

  // Start of a round: bots shot last round are gone, everyone gets a fresh random spot (so
  // nobody can follow their blob over from the last round), and bots are topped up again.
  function resetRoom (world) {
    world.blobs = world.blobs.filter(b => !b.gone)
    for (const b of world.blobs) {
      const p = randomPoint()
      b.x = b.px = p.x; b.y = b.py = p.y; b.vx = b.vy = 0
      b.out = false; b.hidden = false
      if (b.driver) b.driver = makeDriver()
      setInput(b, 0, 0)
    }
    topUpBots(world)
  }

  function step (world, dt) {
    world.time += dt
    for (const b of world.blobs) {
      if (b.hidden) continue
      // Held by the Hunter's net: no movement, and a bot's driver waits too.
      if (b.heldUntil && b.heldUntil > world.time) { b.px = b.x; b.py = b.y; b.vx = b.vy = 0; continue }
      b.px = b.x; b.py = b.y        // for smooth drawing between steps
      if (b.driver) drive(b, dt)
      stepHuman(b, dt)
      b.x = clamp(b.x + b.vx * dt, MARGIN, W - MARGIN)
      b.y = clamp(b.y + b.vy * dt, MARGIN, H - MARGIN)
      if (b.vx || b.vy) {
        b.facing = Math.atan2(b.vy, b.vx)
        b.walkPhase += dt * 9
      }
    }
    separate(world)
  }

  // ---- Soft separation: blobs bump instead of walking through each other ----
  // After everyone has moved, each overlapping pair is pushed apart along the line between
  // their centres, half the overlap each. One pass a step is enough: what is left over is
  // sorted out over the next few steps, so crowds squash and ease apart rather than snap.
  // Nothing here looks at a blob's kind, and world.blobs is in random order (insertRandom),
  // so bots and humans are pushed exactly alike. Hard blocking is deliberately not used:
  // bots would stall face to face where a person steers round (ROADMAP, "Collision").
  //
  // Who takes part:
  // - Hidden blobs (the Hunter's own) are not in the room at all: never solid.
  // - Shot bots (gone) are not solid. They are already marked "bot" for everyone to see and
  //   leave a moment later, so letting others pass through them hides nothing, and it saves a
  //   crowd being shoved about by a blob that is about to vanish.
  // - Caught humans (out) stay solid and pushable, like a bot standing still, so no gap in
  //   the crowd and no "walk-through" marks them.
  // - Blobs held by the net (heldUntil) are solid but pinned: others are pushed off them by
  //   the full overlap and they don't budge, and two held blobs leave each other alone. The
  //   net holds bots and humans alike, so this can't tell them apart either way; pinning keeps
  //   the net's promise that everything under it stands perfectly still until released.
  const SEP_DIST = BLOB_R * 2
  const solid = b => !b.hidden && !b.gone
  const pinned = (b, t) => !!b.heldUntil && b.heldUntil > t

  function separate (world) {
    const blobs = world.blobs
    const t = world.time
    const n = blobs.length
    for (let i = 0; i < n; i++) {
      const a = blobs[i]
      if (!solid(a)) continue
      const pa = pinned(a, t)
      for (let j = i + 1; j < n; j++) {
        const b = blobs[j]
        if (!solid(b)) continue
        let dx = b.x - a.x
        let dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= SEP_DIST * SEP_DIST) continue
        const pb = pinned(b, t)
        if (pa && pb) continue
        let d = Math.sqrt(d2)
        const push = SEP_DIST - d
        if (d < 1e-6) {                 // exactly on top of each other: any direction will do
          const ang = Math.random() * Math.PI * 2
          dx = Math.cos(ang); dy = Math.sin(ang); d = 1
        }
        const ux = dx / d
        const uy = dy / d
        const sa = pa ? 0 : pb ? 1 : 0.5
        const sb = 1 - sa
        if (sa) {
          a.x = clamp(a.x - ux * push * sa, MARGIN, W - MARGIN)
          a.y = clamp(a.y - uy * push * sa, MARGIN, H - MARGIN)
        }
        if (sb) {
          b.x = clamp(b.x + ux * push * sb, MARGIN, W - MARGIN)
          b.y = clamp(b.y + uy * push * sb, MARGIN, H - MARGIN)
        }
      }
    }
  }

  // ---- Tasks: three landmarks in order. Stay within range for 1.5 s to tick one off ----
  const TASK_RANGE = 100      // world units from the landmark's centre
  const TASK_HOLD = 1.5       // seconds in range, without leaving
  const TASK_POINTS = 1
  const ALL_DONE_BONUS = 2

  function dealTasks () {
    const ids = LANDMARKS.map(l => l.id)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]]
    }
    return { tasks: ids.slice(0, 3), done: 0, hold: 0 }
  }

  // Advances one player's task. Returns the points earned this step (0 most of the time).
  function stepTask (t, blob, dt) {
    if (!t || t.done >= t.tasks.length || blob.out) { if (t) t.hold = 0; return 0 }
    const lm = LANDMARKS.find(l => l.id === t.tasks[t.done])
    if (Math.hypot(blob.x - lm.x, blob.y - lm.y) > TASK_RANGE) { t.hold = 0; return 0 }
    t.hold += dt
    if (t.hold < TASK_HOLD) return 0
    t.hold = 0
    t.done++
    return TASK_POINTS + (t.done === t.tasks.length ? ALL_DONE_BONUS : 0)
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, {
    sim: { W, H, BLOB_R, SPEED, MARGIN, STICK_DEADZONE, LANDMARKS, setMap, mapId: () => mapId, createWorld, addHuman, resetRoom, topUpBots, step, separate, TASK_RANGE, TASK_HOLD, dealTasks, stepTask, setInput, makeDriver, pickTarget, nearLandmark, rand },
  })
})()
