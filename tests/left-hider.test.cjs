// A hider who has left must not keep the round running once the Hunter has caught everyone else
// (ROADMAP problem 3), but a short drop-out (under AWAY_GRACE) must not end it either.
const { chromium, devices } = require('playwright')
const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []; let bad = 0
  const check = (what, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++ }
  const tv = await (await b.newContext()).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ctx = {}
  for (const n of ['Ada', 'Bo', 'Cy']) { const c = await b.newContext(devices['iPhone 13']); const p = await c.newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); ctx[n] = c }
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(500)
  const g = (f, a) => tv.evaluate(f, a)
  const state = () => g(() => ({ phase: window.__actNatural.game.phase, reason: window.__actNatural.game.endReason }))
  check('Ada is the Hunter', await g(() => window.__actNatural.game.hunter.name) === 'Ada')
  // Cy's phone goes away.
  // (Closing the browser alone can take WebRTC a long time to notice, so close the link from the TV too.)
  await ctx.Cy.close()
  await g(() => { const p = [...window.__actNatural.game.players.values()].find(q => q.name === 'Cy'); if (p.conn) p.conn.close() })
  let away = false
  for (let i = 0; i < 40 && !away; i++) { await tv.waitForTimeout(250); away = await g(() => ![...window.__actNatural.game.players.values()].find(p => p.name === 'Cy').conn) }
  check('the TV notices Cy has left', away)
  // The Hunter catches Bo while Cy has only just gone: the round goes on.
  const shoot = name => g(n => { const G = window.__actNatural.game; const p = [...G.players.values()].find(q => q.name === n); for (const [a, bl] of G.aliases) if (bl === p.blob) return G.shoot(G.hunter, a).type }, name)
  check('Bo is caught', await shoot('Bo') === 'caught')
  check('round goes on while Cy has only just dropped out', (await state()).phase === 'round')
  // Cy stays away beyond the grace period (test only: wind Cy's away time back).
  await g(() => { const G = window.__actNatural.game; const p = [...G.players.values()].find(q => q.name === 'Cy'); p.awaySince -= window.ActNatural.round.AWAY_GRACE + 1 })
  await tv.waitForTimeout(300)
  const s = await state()
  check('round ends once Cy has been gone longer than the grace period: ' + JSON.stringify(s), s.phase === 'results' && s.reason === 'all-caught')
  check('no page errors ' + JSON.stringify(errs), errs.length === 0)
  await b.close(); process.exit(bad ? 1 : 0)
})().catch(e => { console.error('FAILED', e); process.exit(1) })
