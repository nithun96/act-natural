// Soft separation (sim.js): blobs bump instead of walking through each other, and it must not
// give humans away. Runs the simulation headlessly, much faster than real time, and compares
// fake humans with bots over 10 simulated minutes: contact time, time moving, walks per minute,
// path straightness and how often a walk gets stuck. Fake humans are steered by the same virtual
// thumb as bots (?host&demo), so this checks that the separation code treats both kinds the
// same; whether real players move differently once they can bump is a question for a playtest.
const { chromium } = require('playwright')
const base = (process.env.BASE || 'http://localhost:8765/act-natural/')
const out = process.argv[2] || require('path').join(__dirname, 'out')
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host&demo=6'); await tv.waitForTimeout(3000)
  await tv.screenshot({ path: out + '/collision-demo.png' })
  let failed = false
  const fail = msg => { console.log('FAIL', msg); failed = true }

  // ---- The rules, on a tiny hand-made world ----
  const rules = await tv.evaluate(() => {
    const { sim } = window.ActNatural
    const R = sim.BLOB_R
    const mk = (x, y, extra) => Object.assign({ x, y, px: x, py: y, vx: 0, vy: 0 }, extra)
    const run = (blobs, time = 0) => { const w = { time, blobs }; sim.separate(w); return blobs }
    const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
    const r = {}
    let [p, q] = run([mk(500, 500), mk(510, 500)])
    r.halfEach = [500 - p.x, q.x - 510]                       // expect [13, 13]
    ;[p, q] = run([mk(500, 500), mk(510, 500, { hidden: true })])
    r.hidden = [p.x, q.x]                                     // untouched
    ;[p, q] = run([mk(500, 500), mk(510, 500, { gone: true })])
    r.gone = [p.x, q.x]                                       // untouched
    ;[p, q] = run([mk(500, 500), mk(510, 500, { out: true })])
    r.outGap = gap(p, q)                                      // pushed apart: 2R
    ;[p, q] = run([mk(500, 500, { heldUntil: 10 }), mk(510, 500)], 5)
    r.held = [p.x, gap(p, q)]                                 // held stays put, other takes it all
    ;[p, q] = run([mk(500, 500, { heldUntil: 10 }), mk(510, 500, { heldUntil: 10 })], 5)
    r.bothHeld = [p.x, q.x]
    ;[p, q] = run([mk(sim.MARGIN, 300), mk(sim.MARGIN + 5, 300)])
    r.wall = [p.x, q.x]                                       // nobody leaves the room
    ;[p, q] = run([mk(700, 700), mk(700, 700)])
    r.sameSpot = gap(p, q)
    r.R = R; r.MARGIN = sim.MARGIN
    return r
  })
  console.log('rules:', JSON.stringify(rules))
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e
  const D = rules.R * 2
  if (!near(rules.halfEach[0], (D - 10) / 2) || !near(rules.halfEach[1], (D - 10) / 2)) fail('overlap not split half each')
  if (rules.hidden[0] !== 500 || rules.hidden[1] !== 510) fail('hidden blob collided')
  if (rules.gone[0] !== 500 || rules.gone[1] !== 510) fail('shot bot collided')
  if (!near(rules.outGap, D)) fail('caught human not solid')
  if (rules.held[0] !== 500 || !near(rules.held[1], D)) fail('held blob moved, or the other was not pushed off it')
  if (rules.bothHeld[0] !== 500 || rules.bothHeld[1] !== 510) fail('two held blobs pushed each other')
  if (rules.wall[0] < rules.MARGIN || rules.wall[1] < rules.MARGIN) fail('pushed out of the room')
  if (!near(rules.sameSpot, D)) fail('blobs on the same spot not separated')

  // ---- Tells: 20 fake humans and 40 bots (60 blobs) for 10 simulated minutes ----
  const stats = await tv.evaluate(() => {
    const { sim } = window.ActNatural
    const world = sim.createWorld({ humans: 20 })
    for (const b of world.blobs) if (b.kind === 'human') b.driver = sim.makeDriver()
    const STEP = 1 / 60, MINUTES = 10, WARMUP = 10 / STEP
    const steps = MINUTES * 60 / STEP
    const D = sim.BLOB_R * 2
    const st = new Map(world.blobs.map(b => [b, { contact: 0, moving: 0, n: 0, walks: 0, straight: [], stuck: 0, walk: null, win: [] }]))
    let overlapSum = 0, overlapMax = 0, pairs = 0, outside = 0, ms = 0
    for (let i = 0; i < WARMUP + steps; i++) {
      const t0 = performance.now()
      sim.step(world, STEP)
      ms += performance.now() - t0
      if (i < WARMUP) continue
      const bl = world.blobs
      const touching = new Set()
      for (let a = 0; a < bl.length; a++) for (let c = a + 1; c < bl.length; c++) {
        const d = Math.hypot(bl[a].x - bl[c].x, bl[a].y - bl[c].y)
        if (d < D + 0.5) { touching.add(bl[a]); touching.add(bl[c]) }
        if (d < D) { overlapSum += D - d; overlapMax = Math.max(overlapMax, D - d); pairs++ }
      }
      for (const b of bl) {
        const s = st.get(b)
        if (b.x < sim.MARGIN || b.x > sim.W - sim.MARGIN || b.y < sim.MARGIN || b.y > sim.H - sim.MARGIN) outside++
        const moved = Math.hypot(b.x - b.px, b.y - b.py)
        s.n++
        if (touching.has(b)) s.contact++
        if (moved > 0.05) s.moving++
        const walking = !!(b.vx || b.vy)               // the blob's own stick, not pushes
        if (walking) {
          if (!s.walk) { s.walk = { x: b.px, y: b.py, len: 0 }; s.walks++; s.win = [] }
          s.walk.len += moved
          // Stuck: trying to walk for a whole second but covering under a quarter of the distance.
          s.win.push([b.x, b.y])
          if (s.win.length > 60) {
            const [ox, oy] = s.win.shift()
            if (Math.hypot(b.x - ox, b.y - oy) < sim.SPEED * 0.25) { s.stuck++; s.win = [] }
          }
        } else if (s.walk) {
          if (s.walk.len > 30) s.straight.push(Math.hypot(b.x - s.walk.x, b.y - s.walk.y) / s.walk.len)
          s.walk = null
        }
      }
    }
    const group = kind => {
      const ss = world.blobs.filter(b => b.kind === kind).map(b => st.get(b))
      const n = ss.reduce((t, s) => t + s.n, 0)
      const all = ss.flatMap(s => s.straight)
      const mins = n * STEP / 60
      return {
        blobs: ss.length,
        contact: ss.reduce((t, s) => t + s.contact, 0) / n,
        moving: ss.reduce((t, s) => t + s.moving, 0) / n,
        walksPerMin: ss.reduce((t, s) => t + s.walks, 0) / mins,
        straightness: all.reduce((t, v) => t + v, 0) / all.length,
        stuckPerMin: ss.reduce((t, s) => t + s.stuck, 0) / mins,
      }
    }
    return {
      human: group('human'), bot: group('bot'),
      meanOverlap: pairs ? overlapSum / pairs : 0, maxOverlap: overlapMax, outside,
      msPerMinute: ms / (WARMUP + steps) * 3600,
    }
  })
  const f = (v, d = 3) => v.toFixed(d)
  console.log(`blobs: ${stats.human.blobs} fake humans, ${stats.bot.blobs} bots, 10 simulated minutes`)
  console.log(`sim cost: ${f(stats.msPerMinute, 1)} ms per minute of play · mean overlap ${f(stats.meanOverlap, 2)} · max ${f(stats.maxOverlap, 2)} · outside the room ${stats.outside}`)
  // [metric, relative tolerance, absolute floor]: a difference passes if under either. Stuck
  // walks are rare (a few hundred per run), so that one is the noisiest and gets the most room.
  const checks = [['contact', 0.2, 0.01], ['moving', 0.05, 0.02], ['walksPerMin', 0.08, 0.3], ['straightness', 0.03, 0.01], ['stuckPerMin', 0.4, 0.15]]
  for (const [k, rel, abs] of checks) {
    const h = stats.human[k], bo = stats.bot[k], diff = Math.abs(h - bo)
    const ok = diff <= abs || diff <= rel * Math.max(h, bo)
    console.log(`${ok ? 'ok  ' : 'TELL'} ${k.padEnd(13)} humans ${f(h)} · bots ${f(bo)} · diff ${f(diff)}`)
    if (!ok) fail(`${k} differs between fake humans and bots`)
  }
  if (stats.outside) fail('blobs outside the room')
  if (stats.maxOverlap > rules.R) fail('blobs overlap by more than a radius')

  console.log('errors', errs); await b.close()
  if (errs.length) fail('page errors')
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('FAILED', e); process.exit(1) })
