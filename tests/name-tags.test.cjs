// End-of-round name tags don't overlap when players stand close together (ROADMAP problem 9),
// and a shot ring stays still with reduced motion on (problem 8). Screenshots go to tests/out/.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []; let bad = 0
  const check = (what, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++ }
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const names = ['Ada', 'Bo', 'Cy', 'Dagny', 'Eskil', 'Fredrikke']
  for (const n of names) { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad') }
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(500)
  const g = (f, a) => tv.evaluate(f, a)
  // A shot at a bot with reduced motion: the ring is drawn at full size from the start.
  await g(() => { const G = window.__actNatural.game; const hum = new Set([...G.players.values()].map(p => p.blob)); for (const [a, bl] of G.aliases) if (!hum.has(bl)) { G.shoot(G.hunter, a); return } })
  await tv.waitForTimeout(100); await tv.screenshot({ path: S + '/shot-reduced-motion.png' })
  // Everyone in a tight huddle, then the round ends.
  await g(() => { const G = window.__actNatural.game; let i = 0; for (const p of G.players.values()) { p.blob.x = p.blob.px = 800 + (i % 3) * 14; p.blob.y = p.blob.py = 450 + Math.floor(i / 3) * 14; window.ActNatural.sim.setInput(p.blob, 0, 0); i++ } ; G.endRound() })
  await tv.keyboard.press('q'); await tv.waitForTimeout(300)   // hide the panel so the room shows
  await tv.screenshot({ path: S + '/name-tags-huddle.png' })
  const tags = await g(() => window.__actNatural.nameTags().map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, text: t.text })))
  check('a tag for every hider and none for the Hunter: ' + tags.map(t => t.text).join(', '), tags.length === names.length - 1)
  let overlaps = 0
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) { const a = tags[i], c = tags[j]; if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) overlaps++ }
  check('no two name tags overlap', overlaps === 0)
  check('every tag inside the room', tags.every(t => t.x >= 0 && t.x + t.w <= 1600 && t.y >= 0 && t.y + t.h <= 900))
  check('no page errors ' + JSON.stringify(errs), errs.length === 0)
  await b.close(); process.exit(bad ? 1 : 0)
})().catch(e => { console.error('FAILED', e); process.exit(1) })
