// The TV reloads in the middle of a game: scores, the round, who has hunted and kicks survive,
// the round that was running ends there with its points kept, and the phones rejoin with their scores.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=' + (process.env.SIGNAL || '127.0.0.1:9000')
;(async () => {
  const b = await chromium.launch(); const errs = []; const fails = []
  const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${got !== undefined ? ': ' + JSON.stringify(got) : ''}`); if (!ok) fails.push(what) }
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  tv.on('dialog', d => d.accept())
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code', { timeout: 15000 }); const code = await tv.textContent('.lobby .code')
  const ph = {}
  for (const n of ['Ada', 'Bo', 'Cy']) {
    const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message))
    await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad', { timeout: 15000 }); ph[n] = p
  }
  const txt = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ').trim()
  const state = () => tv.evaluate(() => {
    const g = window.__actNatural.game
    return {
      phase: g.phase, round: g.round, endReason: g.endReason, hunter: g.hunter && g.hunter.name,
      hunted: [...g.hunted].map(t => (g.players.get(t) || {}).name).sort(), kicked: g.kicked.size,
      players: [...g.players.values()].sort((a, b) => a.order - b.order).map(p => ({ n: p.name, s: p.score, on: !!p.conn })),
    }
  })
  // Round 1 (Ada hunts): Bo scores 2, then the host ends it.
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(500)
  await tv.evaluate(() => { const g = window.__actNatural.game; const bo = [...g.players.values()].find(p => p.name === 'Bo'); bo.score += 2; bo.roundPts += 2; g.onChange() })
  await tv.keyboard.press('e'); await tv.waitForTimeout(400)
  // Between rounds: kick Cy.
  const cyToken = await tv.evaluate(() => [...window.__actNatural.game.players.values()].find(p => p.name === 'Cy').token)
  await tv.click('button.kick[aria-label="Kick Cy"]'); await tv.waitForTimeout(500)
  // Round 2 (Bo hunts): Ada scores 4, and the TV reloads mid-round.
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(500)
  await tv.evaluate(() => { const g = window.__actNatural.game; const ada = [...g.players.values()].find(p => p.name === 'Ada'); ada.score += 4; ada.roundPts += 4; g.onChange() })
  const before = await state()
  console.log('before reload:', JSON.stringify(before))
  check('round 2 running before the reload', before.phase === 'round' && before.round === 2 && before.hunter === 'Bo', before)

  await tv.reload(); await tv.waitForSelector('.lobby .board', { timeout: 60000 })   // the results table: the room is open again
  const at = await state()
  console.log('just after reload:', JSON.stringify(at))
  check('same room code', (await txt(tv, '.lobby .keys')).includes('Room ' + code))
  check('round 2 shown as results, ended by the reload', at.phase === 'results' && at.round === 2 && at.endReason === 'reload' && at.hunter === 'Bo', at)
  check('scores kept (Ada 4, Bo 2), Cy still gone', JSON.stringify(at.players.map(p => [p.n, p.s])) === JSON.stringify([['Ada', 4], ['Bo', 2]]), at.players)
  check('who has hunted kept', JSON.stringify(at.hunted) === JSON.stringify(['Ada', 'Bo']), at.hunted)
  check('kick kept', at.kicked === 1 && await tv.evaluate(t => window.__actNatural.game.kicked.has(t), cyToken))
  check('TV panel explains the reload', /TV was reloaded/.test(await txt(tv, '.lobby')))

  // Phones come back on their own and get their records back.
  let on = []
  for (let i = 0; i < 60; i++) { on = (await state()).players.filter(p => p.on); if (on.length === 2) break; await tv.waitForTimeout(500) }
  const back = await state()
  check('both phones rejoined, no duplicates', on.length === 2 && back.players.length === 2, back.players)
  await ph.Ada.waitForTimeout(500)
  const adaView = await txt(ph.Ada, 'main')
  console.log('Ada phone:', adaView.slice(0, 160))
  check('Ada\'s phone shows her score', /\b4\b/.test(adaView))
  // Everyone still in has hunted: the next step is the final scores.
  check('next is final scores', /Final scores/.test(await txt(tv, '#next')), await txt(tv, '#next'))

  // Cy is still kicked after the reload.
  await ph.Cy.reload(); await ph.Cy.waitForSelector('#name', { timeout: 15000 }); await ph.Cy.fill('#name', 'Cy'); await ph.Cy.click('button[type=submit]'); await ph.Cy.waitForTimeout(3000)
  check('Cy can\'t join again', (await state()).players.length === 2, await txt(ph.Cy, 'main'))

  // A snapshot older than 6 hours is ignored: the TV starts clean.
  // (The TV saves again as it unloads, so the snapshot is aged as the next page starts, before the game's scripts run.)
  for (const p of Object.values(ph)) await p.close()
  await tv.context().addInitScript(() => { try { const k = 'act-natural-game'; const s = JSON.parse(localStorage.getItem(k)); s.at -= 7 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(s)) } catch (e) {} })
  await tv.reload(); await tv.waitForSelector('.lobby .code', { timeout: 60000 })
  const old = await state()
  check('old snapshot ignored', old.phase === 'lobby' && old.round === 0 && old.players.length === 0 && old.kicked === 0, old)
  await tv.screenshot({ path: S + '/tv-reload.png' })

  check('no page errors', errs.length === 0, errs)
  await b.close()
  if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1) }
})().catch(e => { console.error('FAILED', e); process.exit(1) })
