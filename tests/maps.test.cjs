const { chromium, devices } = require('playwright')
const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tvc = await b.newContext(); const tv = await tvc.newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push('ph ' + e.message))
  await p.goto(base + '?room=' + code + sig); await p.fill('#name', 'Ada'); await p.click('button[type=submit]'); await p.waitForSelector('#pad')
  for (let i = 0; i < 3; i++) {
    await tv.keyboard.press('m'); await p.waitForTimeout(400)
    console.log('TV:', (await tv.textContent('.mapline')).replace(/\s+/g, ' ').trim(), '| phone landmarks:', await p.evaluate(() => window.ActNatural.sim.LANDMARKS.map(l => l.name).join(', ')))
  }
  // Start a round on Jaffna-ish map with a second player and check tasks use the map's landmarks
  const q = await (await b.newContext(devices['iPhone 13'])).newPage()
  await q.goto(base + '?room=' + code + sig); await q.fill('#name', 'Bo'); await q.click('button[type=submit]'); await q.waitForSelector('#pad')
  await tv.keyboard.press('Enter'); await q.waitForTimeout(500)
  const hider = (await p.$('#tasklist')) ? p : q
  console.log('hider tasks:', (await hider.textContent('#tasklist')).replace(/\s+/g, ' '))
  await tv.keyboard.press('m'); await tv.waitForTimeout(200)
  console.log('M during round ignored:', (await tv.evaluate(() => window.ActNatural.sim.mapId())))
  await hider.screenshot({ path: (process.argv[2] || require('path').join(__dirname, 'out')) + '/phone-stovner.png' })
  await tv.reload(); await tv.waitForSelector('.lobby .mapline', { timeout: 15000 })
  console.log('after TV reload:', (await tv.textContent('.mapline')).replace(/\s+/g, ' ').trim())
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
