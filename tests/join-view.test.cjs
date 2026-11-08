// The full-screen join view (J): opens by itself before round 1, shows the same QR code and room
// code as the panel at a size readable across a room, lists who has joined (away shown in text),
// closes with J and Esc, and closes when a round starts. Screenshots at 1920×1080 and 1280×720.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
require('fs').mkdirSync(S, { recursive: true })
;(async () => {
  const b = await chromium.launch(); const errs = []; const fails = []
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what) }
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  tv.on('dialog', d => d.accept())
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.joinview .jv-code', { timeout: 15000 })
  const code = (await tv.textContent('.lobby .code')).trim()
  const view = () => tv.evaluate(() => {
    const v = document.querySelector('.joinview'); const box = s => { const e = v.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top, fs: parseFloat(getComputedStyle(e).fontSize) } }
    return { open: !v.hidden && getComputedStyle(v).display !== 'none', qr: box('.qr'), code: box('.jv-code'), codeText: (v.querySelector('.jv-code') || {}).textContent, qrSrc: (v.querySelector('.qr') || {}).src, panelSrc: (document.querySelector('.lobby .qr') || {}).src, text: v.textContent.replace(/\s+/g, ' ') }
  })
  const fits = (r, W, H) => r && r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H

  // Opens by itself before round 1
  let v = await view()
  check(v.open, 'join view opens by itself in the lobby before round 1')
  check(v.codeText === code, `room code shown (${v.codeText})`)
  check(v.qrSrc && v.qrSrc === v.panelSrc, 'same QR code as the panel')
  check(v.qr.w >= 600, `QR code is large at 1920×1080 (${Math.round(v.qr.w)} px)`)
  check(v.code.fs >= 120, `room code is large at 1920×1080 (${Math.round(v.code.fs)} px)`)
  check(fits(v.qr, 1920, 1080) && fits(v.code, 1920, 1080), 'QR and code fit on screen at 1920×1080')
  check(/Nobody has joined yet/.test(v.text), 'says nobody has joined yet')

  // J closes and reopens it; Esc closes it
  await tv.keyboard.press('j'); await tv.waitForTimeout(100)
  check(!(await view()).open, 'J closes it')
  await tv.keyboard.press('j'); await tv.waitForTimeout(100)
  check((await view()).open, 'J opens it again')
  await tv.keyboard.press('Escape'); await tv.waitForTimeout(100)
  check(!(await view()).open, 'Esc closes it')
  await tv.click('#joinview'); await tv.waitForTimeout(100)
  check((await view()).open, 'the panel button opens it')

  // Phones join: their names appear; a phone that drops shows as away (in words)
  const ph = {}
  for (const name of ['Ada', 'Bo', 'Cy']) {
    const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(name + ' ' + e.message))
    await p.goto(base + '?room=' + code + sig); await p.fill('#name', name); await p.click('button[type=submit]'); await p.waitForSelector('#pad', { timeout: 15000 }); ph[name] = p
  }
  await tv.waitForTimeout(400)
  v = await view()
  check(['Ada', 'Bo', 'Cy'].every(n => v.text.includes(n)) && /3 players in/.test(v.text), 'joined names appear in the join view')
  await ph.Cy.close(); await tv.waitForTimeout(1500)
  const away = await tv.$$eval('.joinview li.away', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()))
  console.log('away rows:', away)
  check(away.length === 1 && /Cy/.test(away[0]) && /away/.test(away[0]), 'a dropped phone is marked "away" in text')
  await tv.screenshot({ path: S + '/join-view-1920.png' })

  // 1280×720 laptop: everything still fits
  await tv.setViewportSize({ width: 1280, height: 720 }); await tv.waitForTimeout(200)
  v = await view()
  const side = await tv.$eval('.joinview .jv-side', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  check(fits(v.qr, 1280, 720) && fits(v.code, 1280, 720) && fits(side, 1280, 720), 'QR, code and side column fit at 1280×720')
  check(v.qr.w >= 400 && v.code.fs >= 80, `still large at 1280×720 (QR ${Math.round(v.qr.w)} px, code ${Math.round(v.code.fs)} px)`)
  await tv.screenshot({ path: S + '/join-view-1280.png' })

  // Enter starts round 1 from the join view, which closes it; J does nothing during a round
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(600)
  check(await tv.evaluate(() => window.__actNatural.game.phase) === 'round', 'Enter starts the round from the join view')
  check(!(await view()).open, 'starting a round closes the join view')
  await tv.keyboard.press('j'); await tv.waitForTimeout(100)
  check(!(await view()).open, 'J does not open it during a round')

  check(!errs.length, 'no page errors ' + JSON.stringify(errs))
  await b.close()
  if (fails.length) { console.error('FAILED:', fails); process.exit(1) }
  console.log('join view: all good')
})().catch(e => { console.error('FAILED', e); process.exit(1) })
