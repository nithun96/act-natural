const { chromium, devices } = require('playwright');
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const watch = (p, n) => { p.on('pageerror', e => errs.push(n + ': ' + e.message)) }
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); watch(tv, 'tv')
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code', { timeout: 15000 })
  const code1 = await tv.textContent('.lobby .code')
  console.log('panel:', (await tv.textContent('.lobby')).replace(/\s+/g, ' '))
  const phones = []
  for (const name of ['Ada', 'Bo']) {
    const p = await (await b.newContext(devices['iPhone 13'])).newPage(); watch(p, name)
    await p.goto(base + '?room=' + code1 + sig); await p.fill('#name', name); await p.click('button[type=submit]')
    await p.waitForSelector('#pad', { timeout: 15000 }); phones.push(p)
  }
  const t0 = Date.now()
  await tv.reload(); await tv.waitForSelector('.lobby .code', { timeout: 60000 })
  const code2 = await tv.textContent('.lobby .code')
  console.log('TV reload: code', code1, '->', code2, 'reopened in', Date.now() - t0, 'ms')
  let n = 0; for (let i = 0; i < 40; i++) { n = await tv.evaluate(() => [...window.__actNatural.players.values()].filter(p => p.conn).length); if (n === 2) break; await tv.waitForTimeout(500) }
  console.log('phones back on TV:', n, 'after', Date.now() - t0, 'ms; phone screens:', await phones[0].$('#pad') ? 'controller' : 'other', await phones[1].$('#pad') ? 'controller' : 'other')
  // landing join with typed code
  const q = await (await b.newContext(devices['iPhone 13'])).newPage()
  await q.goto(base + '?' + sig.slice(1)); await q.fill('#code', code2.toLowerCase()); await q.click('button[type=submit]')
  await q.waitForSelector('#name'); console.log('typed code goes to:', new URL(q.url()).search)
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
