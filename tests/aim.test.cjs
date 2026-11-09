// Aiming on a small phone (iPhone SE, 375×667): tapping the same spot again steps through a
// crowd, holding opens a magnifier beside the thumb, and lifting aims at the blob it rings.
// The whole room is pinned (as under the net) so the blobs stand still while we aim.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []; let failed = 0
  const check = (ok, what, extra) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra != null ? ' (' + extra + ')' : ''}`); if (!ok) failed++ }
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const join = async (n, dev) => { const p = await (await b.newContext(devices[dev])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad, #hmap, .card', { timeout: 20000 }); return p }
  const A = await join('Ada', 'iPhone SE (3rd gen)')
  for (const n of ['Bo', 'Cy']) await join(n, 'iPhone 13')
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(700)
  await A.waitForSelector('#hmap')
  const g = (f, a) => tv.evaluate(f, a)

  // Pin every blob; put three bots in a tight cluster at P (touching: 0, 30 and 34 world px from it; blobs are 36 across) and clear the area round it and round (400, 800), the empty spot tapped below.
  const P = { x: 800, y: 470 }
  const ids = await g(P => {
    const { world, game: G } = window.__actNatural
    const hum = new Set([...G.players.values()].map(p => p.blob))
    const live = [...G.aliases.entries()].filter(([, x]) => !x.out && !x.gone)
    const bots = live.filter(([, x]) => !hum.has(x)).slice(0, 3)
    for (const x of world.blobs) x.heldUntil = world.time + 600
    let k = 0
    for (const [, x] of live) {   // everyone else well away from P, in a row along the top
      if (bots.some(([, y]) => y === x)) continue
      if (Math.hypot(x.x - P.x, x.y - P.y) < 300 || Math.hypot(x.x - 400, x.y - 800) < 300) { x.x = x.px = 120 + (k++ % 20) * 65; x.y = x.py = 120 }
    }
    const offs = [[0, 0], [30, 0], [0, 34]]
    bots.forEach(([, x], i) => { x.x = x.px = P.x + offs[i][0]; x.y = x.py = P.y + offs[i][1] })
    return bots.map(([a]) => a)
  }, P)
  await A.waitForTimeout(400)
  const aim = () => g(() => { const G = window.__actNatural.game; if (!G.aim) return null; for (const [a, x] of G.aliases) if (x === G.aim) return a; return null })
  const rect = () => A.$eval('#hmap', e => { const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height } })
  const r = await rect()
  const at = (wx, wy) => ({ clientX: r.x + wx / 1600 * r.w, clientY: r.y + wy / 900 * r.h, pointerId: 11, isPrimary: true, pointerType: 'touch' })
  const ev = (type, o) => A.dispatchEvent('#hmap', type, o)
  const tap = async o => { await ev('pointerdown', o); await ev('pointerup', o); await A.waitForTimeout(200) }
  const note = () => A.textContent('#aimnote')
  console.log('map on iPhone SE:', Math.round(r.w) + '×' + Math.round(r.h), 'CSS px; cluster', ids)

  // 1. Tapping the same spot steps through the crowd, nearest first, and wraps round.
  const p0 = at(P.x, P.y)
  await tap(p0); check(await aim() === ids[0], 'first tap aims at the nearest', await note())
  await tap(p0); check(await aim() === ids[1], 'second tap at the same spot: next nearest', await note())
  check(/2 of 3 here/.test(await note()), 'note says which of the crowd', await note())
  await tap(p0); check(await aim() === ids[2], 'third tap: the third')
  await tap(p0); check(await aim() === ids[0], 'fourth tap wraps round to the first')

  // 2. A tap in empty space aims at nothing (it used to aim at blob 0).
  await tap(at(400, 800)); check(await aim() === null, 'tap in empty space aims at nothing')

  // 3. Hold: the magnifier opens beside the thumb; sliding moves the aim point at half speed; lifting aims.
  await A.waitForTimeout(2600)                       // past the stepping window
  await ev('pointerdown', p0)
  check(!(await A.$eval('#loupe', e => e.classList.contains('on'))), 'no magnifier straight away')
  await A.waitForTimeout(450)
  const lo = await A.$eval('#loupe', e => { const q = e.getBoundingClientRect(); return { on: e.classList.contains('on'), vis: getComputedStyle(e).visibility, x: q.left, y: q.top, w: q.width, h: q.height } })
  const vp = A.viewportSize()
  check(lo.on && lo.vis === 'visible', 'holding opens the magnifier')
  check(lo.x >= 0 && lo.y >= 0 && lo.x + lo.w <= vp.width && lo.y + lo.h <= vp.height, 'magnifier fits on the screen', JSON.stringify(lo))
  const fx = p0.clientX, fy = p0.clientY
  check(!(fx >= lo.x && fx <= lo.x + lo.w && fy >= lo.y && fy <= lo.y + lo.h), 'magnifier is not under the thumb')
  const before = await aim()
  // Slide down: 34 world px to the third blob is ~7.6 CSS px on this map, so the finger moves twice that.
  const down = 34 / 900 * r.h * 2
  for (let i = 1; i <= 4; i++) { await ev('pointermove', { ...p0, clientY: fy + down * i / 4 }); await A.waitForTimeout(40) }
  await A.waitForTimeout(150)
  await A.screenshot({ path: S + '/aim-loupe-phone.png' })
  check(await aim() === before, 'sliding does not move the TV crosshair until lifting')
  await ev('pointerup', { ...p0, clientY: fy + down }); await A.waitForTimeout(250)
  check(await aim() === ids[2], 'lifting aims at the blob ringed in the magnifier')
  check(!(await A.$eval('#loupe', e => e.classList.contains('on'))), 'magnifier closes on lift')

  // 4. Sliding opens it at once (no wait), and a cancelled press keeps the aim.
  await ev('pointerdown', p0); await ev('pointermove', { ...p0, clientX: fx + 14 }); await A.waitForTimeout(60)
  check(await A.$eval('#loupe', e => e.classList.contains('on')), 'sliding opens the magnifier before the hold time')
  const kept = await aim()
  await ev('pointercancel', p0); await A.waitForTimeout(200)
  check(await aim() === kept && !(await A.$eval('#loupe', e => e.classList.contains('on'))), 'cancelled press closes it and keeps the aim')

  // 5. Held over empty space and lifted: aims at nothing.
  await ev('pointerdown', at(400, 800)); await A.waitForTimeout(400); await ev('pointerup', at(400, 800)); await A.waitForTimeout(200)
  check(await aim() === null, 'magnifier lifted over empty space aims at nothing')

  // 6. Reduced motion: no transition on the magnifier.
  await A.emulateMedia({ reducedMotion: 'reduce' })
  check(await A.$eval('#loupe', e => getComputedStyle(e).transitionDuration.split(',').every(t => parseFloat(t) === 0)), 'no animation with reduced motion')

  // 7. The phone was told nothing new: the Hunter's view still has no kinds.
  check(await g(() => window.__actNatural.game.hunterView().b.every(x => x.length === 4)), "Hunter's view unchanged: alias, x, y, state")

  console.log('errors', errs); if (errs.length) failed++
  await b.close(); if (failed) { console.error(failed + ' failed'); process.exit(1) }
})().catch(e => { console.error('FAILED', e); process.exit(1) })
