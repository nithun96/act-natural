const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  tv.on('dialog', d => d.accept())
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ph = {}
  for (const n of ['Ada', 'Bo', 'Cy']) { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); ph[n] = p }
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(700)
  const A = ph.Ada, B = ph.Bo; await A.waitForSelector('#hmap')
  const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim()
  const g = (f, a) => tv.evaluate(f, a)
  // Put Bo on his next landmark with three bots around him and Cy far away.
  const setup = await g(() => {
    const W = window.__actNatural, G = W.game, sim = window.ActNatural.sim
    const bo = [...G.players.values()].find(p => p.name === 'Bo'), cy = [...G.players.values()].find(p => p.name === 'Cy')
    const lm = sim.LANDMARKS.find(l => l.id === bo.task.tasks[0])
    bo.blob.x = bo.blob.px = lm.x; bo.blob.y = bo.blob.py = lm.y
    const humans = new Set([...G.players.values()].map(p => p.blob))
    const bots = W.world.blobs.filter(x => !humans.has(x) && !x.hidden).slice(0, 3)
    bots.forEach((x, i) => { x.x = x.px = lm.x + 60 * Math.cos(i * 2); x.y = x.py = lm.y + 60 * Math.sin(i * 2) })
    cy.blob.x = cy.blob.px = lm.x > 800 ? 200 : 1400; cy.blob.y = cy.blob.py = 450
    return { bo: bo.blob.id, bots: bots.map(x => x.id), cy: cy.blob.id }
  })
  // Aim at Bo on the Hunter's phone (by tapping his dot), then throw the net.
  const pos = await g(i => { const x = window.__actNatural.world.blobs.find(z => z.id === i); return { x: x.x / 1600, y: x.y / 900 } }, setup.bo)
  const r = await A.$eval('#hmap', e => { const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height } })
  let aimed = false
  for (let t = 0; t < 6 && !aimed; t++) { const ev = { clientX: r.x + pos.x * r.w, clientY: r.y + pos.y * r.h, pointerId: 7, isPrimary: true }; await A.dispatchEvent('#hmap', 'pointerdown', ev); await A.dispatchEvent('#hmap', 'pointerup', ev); await A.waitForTimeout(250); aimed = await g(() => !!window.__actNatural.game.aim) }
  console.log('aimed:', aimed, '| net button:', await txt(A, '#net'), 'enabled', await A.$eval('#net', e => !e.disabled))
  await A.click('#net'); await A.waitForTimeout(400)
  const held = await g(() => window.__actNatural.world.blobs.filter(x => x.heldUntil > window.__actNatural.world.time).map(x => x.id))
  console.log('toast:', await txt(A, '#toast'), '| held blobs:', held.length, '| Bo held:', held.includes(setup.bo), '| bots near held:', setup.bots.filter(i => held.includes(i)).length + '/3', '| Cy held:', held.includes(setup.cy))
  console.log('Bo banner:', await txt(B, '#netbanner'), '| net button now:', await txt(A, '#net'), 'disabled', await A.$eval('#net', e => e.disabled))
  // Bo pushes his stick during the hold; he must not move, and his landmark progress must stay 0.
  const pad = await B.$eval('#pad', e => { const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 } })
  await B.dispatchEvent('#pad', 'pointerdown', { pointerId: 1, clientX: pad.x, clientY: pad.y, isPrimary: true })
  await B.dispatchEvent('#pad', 'pointermove', { pointerId: 1, clientX: pad.x + 60, clientY: pad.y, isPrimary: true })
  const before = await g(ids => ids.map(i => { const x = window.__actNatural.world.blobs.find(z => z.id === i); return [x.x, x.y] }), [setup.bo, ...setup.bots, setup.cy])
  await tv.screenshot({ path: S + '/net-tv.png' }); await A.screenshot({ path: S + '/net-hunter-phone.png' }); await B.screenshot({ path: S + '/net-hider-phone.png' })
  await tv.waitForTimeout(3000)
  const after = await g(ids => ids.map(i => { const x = window.__actNatural.world.blobs.find(z => z.id === i); return [x.x, x.y] }), [setup.bo, ...setup.bots, setup.cy])
  const moved = before.map((p, i) => Math.round(Math.hypot(after[i][0] - p[0], after[i][1] - p[1])))
  console.log('moved in 3 s while held (Bo, 3 bots, Cy):', moved.join(', '), '| Bo task done/hold:', JSON.stringify(await g(() => { const p = [...window.__actNatural.game.players.values()].find(q => q.name === 'Bo'); return [p.task.done, p.task.hold] })))
  console.log('second net:', await g(() => { const G = window.__actNatural.game; return G.throwNet(G.hunter, [...G.aliases.keys()][0]) }))
  // Release timing: first frame each held blob moves after the net lifts. Bo keeps pushing (phone sends at 15 Hz).
  const timing = await g(async (ids) => {
    const W = window.__actNatural, until = W.game.net.until
    const first = {}; const start = {}
    for (const i of ids) { const x = W.world.blobs.find(z => z.id === i); start[i] = [x.x, x.y] }
    await new Promise(res => { const t = setInterval(() => {
      for (const i of ids) { if (first[i] != null) continue; const x = W.world.blobs.find(z => z.id === i); if (Math.hypot(x.x - start[i][0], x.y - start[i][1]) > 0.5) first[i] = Math.round((W.world.time - until) * 1000) }
      if (W.world.time > until + 4) { clearInterval(t); res() } }, 5) })
    return first
  }, [setup.bo, ...setup.bots])
  console.log('ms after net lifted to first move — Bo:', timing[setup.bo], '| bots:', setup.bots.map(i => timing[i] == null ? 'paused/standing' : timing[i]).join(', '))
  console.log('banner after lift hidden:', await B.$eval('#netbanner', e => e.hidden), '| net still on TV:', await g(() => !!window.__actNatural.game.net))
  await B.dispatchEvent('#pad', 'pointerup', { pointerId: 1, clientX: pad.x + 60, clientY: pad.y, isPrimary: true })
  await tv.keyboard.press('e'); await tv.waitForTimeout(300)
  console.log('after round end: net', await g(() => window.__actNatural.game.net), '| any held', await g(() => window.__actNatural.world.blobs.some(x => x.heldUntil > window.__actNatural.world.time)))
  // Next round: net ready again
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(600)
  console.log('round 2 netUsed:', await g(() => window.__actNatural.game.netUsed))
  console.log('errors', errs.filter(e => !/mqtt/i.test(e))); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
