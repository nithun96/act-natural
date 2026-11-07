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

  const LANDMARKS = [
    { id: 'fountain', name: 'Fountain', x: 800, y: 450, kind: 'fountain' },
    { id: 'lamp', name: 'Lamp', x: 260, y: 210, kind: 'lamp' },
    { id: 'bench', name: 'Bench', x: 1330, y: 190, kind: 'bench' },
    { id: 'tree', name: 'Tree', x: 1350, y: 700, kind: 'tree' },
    { id: 'rug', name: 'Rug', x: 300, y: 690, kind: 'rug' },
  ]

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
      id, kind,                     // kind: 'bot' | 'human'
      x: p.x, y: p.y, vx: 0, vy: 0,
      facing: Math.random() * Math.PI * 2,
      walkPhase: Math.random() * 10,
      // bot state
      target: null, pause: rand(0, 2),
      // human state
      input: { dx: 0, dy: 0, age: Infinity },
      name: null, out: false,
    }
  }

  function createWorld ({ humans = 0 } = {}) {
    const bots = Math.max(16, humans * 2)
    const blobs = []
    for (let i = 0; i < bots; i++) blobs.push(makeBlob('b' + i, 'bot'))
    for (let i = 0; i < humans; i++) blobs.push(makeBlob('h' + i, 'human'))
    // Shuffle so draw order (and therefore overlap) gives nothing away.
    for (let i = blobs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [blobs[i], blobs[j]] = [blobs[j], blobs[i]]
    }
    return { w: W, h: H, time: 0, blobs, landmarks: LANDMARKS }
  }

  // A human's joystick: direction only. Above the deadzone they move at exactly bot speed.
  function setInput (blob, dx, dy) {
    blob.input.dx = dx
    blob.input.dy = dy
    blob.input.age = 0
  }

  function stepBot (b, dt) {
    if (b.pause > 0) {
      b.pause -= dt
      b.vx = b.vy = 0
      if (b.pause <= 0) b.target = pickTarget()
      return
    }
    if (!b.target) b.target = pickTarget()
    const dx = b.target.x - b.x
    const dy = b.target.y - b.y
    const d = Math.hypot(dx, dy)
    if (d <= SPEED * dt) {
      b.x = b.target.x; b.y = b.target.y
      b.vx = b.vy = 0
      b.target = null
      b.pause = rand(0.5, 3)
      return
    }
    b.vx = dx / d * SPEED
    b.vy = dy / d * SPEED
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

  function step (world, dt) {
    world.time += dt
    for (const b of world.blobs) {
      if (b.kind === 'bot') stepBot(b, dt)
      else stepHuman(b, dt)
      b.x = clamp(b.x + b.vx * dt, MARGIN, W - MARGIN)
      b.y = clamp(b.y + b.vy * dt, MARGIN, H - MARGIN)
      if (b.vx || b.vy) {
        b.facing = Math.atan2(b.vy, b.vx)
        b.walkPhase += dt * 9
      }
    }
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, {
    sim: { W, H, BLOB_R, SPEED, MARGIN, STICK_DEADZONE, LANDMARKS, createWorld, step, setInput, pickTarget, nearLandmark, rand },
  })
})()
