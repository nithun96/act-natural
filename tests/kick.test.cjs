const { chromium, devices } = require('playwright')
const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  tv.on('dialog', d => d.accept())
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ph = {}
  for (const n of ['Ada', 'Bo']) { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); ph[n] = p }
  const blobs = () => tv.evaluate(() => window.__actNatural.world.blobs.length)
  console.log('before: players', await tv.evaluate(() => window.__actNatural.players.size), 'blobs', await blobs(), '| kick buttons:', await tv.$$eval('.lobby button.kick', bs => bs.map(x => x.getAttribute('aria-label'))))
  await tv.keyboard.press('Escape')   // close the big join view (open by itself before round 1) to reach the panel
  await tv.click('button.kick[aria-label="Kick Bo"]'); await ph.Bo.waitForTimeout(800)
  console.log('after kick: players', await tv.evaluate(() => [...window.__actNatural.players.values()].map(p => p.name)), 'blobs', await blobs())
  console.log('Bo screen:', (await ph.Bo.textContent('main')).replace(/\s+/g, ' ').trim())
  await ph.Bo.waitForTimeout(3000)
  console.log('Bo after 3 s (no retry):', (await ph.Bo.textContent('main')).replace(/\s+/g, ' ').trim())
  await ph.Bo.reload(); await ph.Bo.waitForTimeout(1500)
  console.log('Bo after reload:', (await ph.Bo.textContent('main')).replace(/\s+/g, ' ').trim().slice(0, 60))
  await ph.Bo.fill('#name', 'Bo'); await ph.Bo.click('button[type=submit]'); await ph.Bo.waitForTimeout(3000)
  console.log('Bo re-submits:', (await ph.Bo.textContent('main')).replace(/\s+/g, ' ').trim(), '| players on TV:', await tv.evaluate(() => window.__actNatural.players.size))
  console.log('Ada still on controller:', !!(await ph.Ada.$('#pad')), '| start button:', (await tv.textContent('#next')).replace(/\s+/g, ' ').trim(), 'disabled', await tv.$eval('#next', e => e.disabled))
  await tv.screenshot({ path: (process.argv[2] || require('path').join(__dirname, 'out')) + '/kick-tv.png' })
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
