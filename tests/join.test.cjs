const { chromium, devices } = require('playwright');
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/');
(async () => {
  const b = await chromium.launch(); const errs = []
  const watch = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(n + ' console: ' + m.text())) }
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); watch(tv, 'tv')
  await tv.goto(base + '?host&signal=127.0.0.1:9000')
  await tv.waitForSelector('.lobby .code', { timeout: 15000 })
  const code = await tv.textContent('.lobby .code'); console.log('room code', code)
  const phones = []
  for (const name of ['Ada', 'Bo']) {
    const ctx = await b.newContext(devices['iPhone 13']); const p = await ctx.newPage(); watch(p, name)
    await p.goto(base + '?room=' + code + '&signal=127.0.0.1:9000')
    await p.fill('#name', name); await p.click('button[type=submit]')
    await p.waitForSelector('#pad', { timeout: 15000 }); phones.push(p)
  }
  await tv.waitForTimeout(500)
  const st = () => tv.evaluate(() => { const { world, players } = window.__actNatural; return { blobs: world.blobs.length, players: [...players.values()].map(p => ({ name: p.name, x: Math.round(p.blob.x), y: Math.round(p.blob.y), on: !!p.conn, vx: p.blob.vx })) } })
  console.log('after join', JSON.stringify(await st()))
  console.log('lobby text:', (await tv.textContent('.lobby')).replace(/\s+/g, ' '))
  await tv.screenshot({ path: S + '/tv-lobby.png' })
  // Drag on Ada's phone: right for 1.5 s
  const p = phones[0]; const before = (await st()).players[0]
  await p.touchscreen.tap(1, 1).catch(() => {})
  const pad = await p.$('#pad'); const box = await pad.boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await p.dispatchEvent('#pad', 'pointerdown', { pointerId: 1, clientX: cx, clientY: cy, isPrimary: true })
  const t0 = Date.now()
  await p.dispatchEvent('#pad', 'pointermove', { pointerId: 1, clientX: cx + 60, clientY: cy, isPrimary: true })
  let lag = null
  for (let i = 0; i < 100; i++) { const s = (await st()).players[0]; if (s.vx > 0) { lag = Date.now() - t0; break } await tv.waitForTimeout(5) }
  console.log('thumb to TV (incl. test polling):', lag, 'ms')
  await p.screenshot({ path: S + '/phone-pad.png' })
  await p.waitForTimeout(1500)
  await p.dispatchEvent('#pad', 'pointerup', { pointerId: 1, clientX: cx + 60, clientY: cy, isPrimary: true })
  await tv.waitForTimeout(300)
  const after = (await st()).players[0]
  console.log('Ada moved', before.x, '->', after.x, 'vx now', after.vx)
  // Hold-to-see map
  console.log('rtt shown:', await p.textContent('#rtt'))
  // Reload Bo: should rejoin the same blob
  const boBefore = await st()
  await phones[1].reload(); await phones[1].waitForSelector('#pad', { timeout: 15000 }); await tv.waitForTimeout(500)
  const boAfter = await st()
  console.log('reload: players', boBefore.players.length, '->', boAfter.players.length, 'blobs', boBefore.blobs, '->', boAfter.blobs, 'Bo on:', boAfter.players[1].on)
  // Bad room code
  const q = await (await b.newContext(devices['iPhone 13'])).newPage()
  await q.goto(base + '?room=ZZZZZ&signal=127.0.0.1:9000'); await q.fill('#name', 'X'); await q.click('button[type=submit]')
  await q.waitForSelector('.note', { timeout: 15000 }); console.log('bad code:', await q.textContent('.note'))
  // Landing
  await q.goto(base); console.log('landing:', (await q.textContent('main')).replace(/\s+/g, ' '))
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
