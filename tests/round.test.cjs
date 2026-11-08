const { chromium, devices } = require('playwright');
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  tv.on('dialog', d => d.accept())
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ph = {}
  for (const name of ['Ada', 'Bo', 'Cy']) {
    const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message))
    await p.goto(base + '?room=' + code + sig); await p.fill('#name', name); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); ph[name] = p
  }
  const txt = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ').trim()
  console.log('lobby button:', await txt(tv, '#next'), '| Bo status:', await txt(ph.Bo, '#statusline'))
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(600)
  await tv.evaluate(() => { window.__actNatural.game.shots = 3 })   // test: skip the recharge wait
  console.log('R1 panel hidden:', await tv.$eval('.lobby', e => e.hidden), '| Ada screen hunter:', !!(await ph.Ada.$('#hmap')), '| Bo:', await txt(ph.Bo, '#statusline'), '|', await txt(ph.Bo, '#tasklist'))
  const g = () => tv.evaluate(() => { const ps = [...window.__actNatural.players.values()]; return ps.map(p => ({ n: p.name, s: p.score, c: p.caught, hid: !!p.blob.hidden, x: p.blob.x / 1600, y: p.blob.y / 900 })) })
  console.log('state:', JSON.stringify(await g()))
  await ph.Ada.waitForTimeout(400)
  const tapAt = async (p, nx, ny) => { const r = await p.$eval('#hmap', e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }); const ev = { clientX: r.x + nx * r.w, clientY: r.y + ny * r.h, pointerId: 5, isPrimary: true }; await p.dispatchEvent('#hmap', 'pointerdown', ev); await p.dispatchEvent('#hmap', 'pointerup', ev) }
  // aim at Bo
  let bo = (await g()).find(p => p.n === 'Bo')
  await tapAt(ph.Ada, bo.x, bo.y); await ph.Ada.waitForTimeout(300)
  console.log('TV aim set:', await tv.evaluate(() => !!window.__actNatural.game.aim), '| shoot enabled:', await ph.Ada.$eval('#shoot', e => !e.disabled))
  await tv.screenshot({ path: S + '/r-aim.png' }); await ph.Ada.screenshot({ path: S + '/r-hunter.png' })
  await ph.Ada.click('#shoot'); await ph.Ada.waitForTimeout(500)
  console.log('after shot: Ada toast:', await txt(ph.Ada, '#toast'), '| Bo screen:', await txt(ph.Bo, 'main'))
  await ph.Bo.screenshot({ path: S + '/r-caught.png' })
  // shoot a bot far from Cy
  const botPos = await tv.evaluate(() => { const w = window.__actNatural.world; const g2 = window.__actNatural.game; const humans = new Set([...g2.players.values()].map(p => p.blob)); const bot = w.blobs.find(b => !humans.has(b) && !b.gone); return { x: bot.x / 1600, y: bot.y / 900 } })
  const cy = (await g()).find(p => p.n === 'Cy')
  console.log('bot-Cy distance (units):', Math.round(Math.hypot((botPos.x - cy.x) * 1600, (botPos.y - cy.y) * 900)))
  await tapAt(ph.Ada, botPos.x, botPos.y); await ph.Ada.waitForTimeout(200); await ph.Ada.click('#shoot'); await ph.Ada.waitForTimeout(400)
  console.log('bot shot toast:', await txt(ph.Ada, '#toast'), '| shots:', await txt(ph.Ada, '#shots'))
  await tv.screenshot({ path: S + '/r-botshot.png' })
  await ph.Ada.waitForTimeout(5300)   // miss lock
  // shoot Cy -> all caught -> results
  const cy2 = (await g()).find(p => p.n === 'Cy')
  await tapAt(ph.Ada, cy2.x, cy2.y); await ph.Ada.waitForTimeout(200); await ph.Ada.click('#shoot'); await ph.Ada.waitForTimeout(600)
  console.log('phase:', await tv.evaluate(() => window.__actNatural.game.phase), '| TV panel:', await txt(tv, '.lobby'))
  console.log('Ada results:', await txt(ph.Ada, 'main'), '|| Bo results:', await txt(ph.Bo, 'main'))
  await tv.screenshot({ path: S + '/r-results.png' })
  // round 2 (Bo hunts), end early; round 3 (Cy), end; then final
  for (const r of [2, 3]) {
    await tv.keyboard.press('Enter'); await tv.waitForTimeout(500)
    console.log(`R${r} hunter:`, await tv.evaluate(() => window.__actNatural.game.hunter.name))
    await tv.keyboard.press('e'); await tv.waitForTimeout(400)
  }
  console.log('after R3 button:', await txt(tv, '#next'))
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
  console.log('final TV:', await txt(tv, '.lobby'), '| Cy phone:', await txt(ph.Cy, 'main'))
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
  console.log('new game phase:', await tv.evaluate(() => window.__actNatural.game.phase), '| scores:', JSON.stringify((await g()).map(p => p.s)))
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
