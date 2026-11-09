// The replay after a round: each hider's path is recorded on the TV only, plays when the round
// ends, shows landmarks ticked off and catches, and R plays it again. With reduced motion it
// shows the whole paths at once. Screenshots go to tests/out/.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/act-natural/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []; let bad = 0
  const check = (what, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++ }
  const run = async (reducedMotion) => {
    const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
    await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
    const phones = {}
    for (const n of ['Ada', 'Bo', 'Cy']) { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); phones[n] = p }
    await tv.keyboard.press('Escape'); await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
    const g = (f, a) => tv.evaluate(f, a)
    const who = n => `[...window.__actNatural.game.players.values()].find(q => q.name === ${JSON.stringify(n)})`
    // Bo and Cy walk about; Bo ticks off a landmark; Cy is caught.
    await g(`window.ActNatural.sim.setInput(${who('Bo')}.blob, 1, 0.3); window.ActNatural.sim.setInput(${who('Cy')}.blob, -0.4, 1)`)
    await tv.waitForTimeout(1500)
    await g(`{ const p = ${who('Bo')}; const lm = window.ActNatural.sim.LANDMARKS.find(l => l.id === p.task.tasks[0]); p.blob.x = lm.x; p.blob.y = lm.y; window.ActNatural.sim.setInput(p.blob, 0, 0) }`)
    await tv.waitForTimeout(1800)
    const leak = await phones.Bo.evaluate(() => 0)   // phones can't see the TV's state; check what the TV would send instead
    const view = await g(`JSON.stringify(window.__actNatural.game.viewFor(${who('Bo')})) + JSON.stringify(window.__actNatural.game.hunterView())`)
    check('nothing about paths goes to phones', !/path|replay/i.test(view) && leak === 0)
    await g(`{ const G = window.__actNatural.game; const p = ${who('Cy')}; for (const [a, bl] of G.aliases) if (bl === p.blob) G.shoot(G.hunter, a) }`)
    await tv.waitForTimeout(300)
    await g(() => window.__actNatural.game.endRound())
    await tv.waitForTimeout(400)
    const r = await g(() => { const r = window.__actNatural.replay(); return { running: r.running, progress: r.progress, paths: r.data && r.data.paths.map(p => ({ name: p.name, n: p.points.length, events: p.events.map(e => e.kind + (e.n || '')) })) } })
    console.log(JSON.stringify(r))
    const bo = (r.paths || []).find(p => p.name === 'Bo'), cy = (r.paths || []).find(p => p.name === 'Cy')
    check('a path for each hider, none for the Hunter', r.paths && r.paths.length === 2 && !r.paths.some(p => p.name === 'Ada'))
    check('paths have points', bo && bo.n > 20 && cy && cy.n > 10)
    check('Bo\'s landmark is on his path', bo && bo.events.includes('task1'))
    check('Cy\'s catch is on her path', cy && cy.events.includes('caught'))
    if (reducedMotion !== 'reduce') {
      check('replay plays when the round ends', r.running && r.progress < 1)
      await tv.keyboard.press('q'); await tv.waitForTimeout(1200)
      await tv.screenshot({ path: S + '/replay-running.png' })
      for (let i = 0; i < 30 && await g(() => window.__actNatural.replay().running); i++) await tv.waitForTimeout(500)
      check('replay finishes', !(await g(() => window.__actNatural.replay().running)))
      await tv.screenshot({ path: S + '/replay-done.png' })
      check('name tags are back after the replay', (await g(() => window.__actNatural.nameTags().length)) === 2)
      await tv.keyboard.press('r'); await tv.waitForTimeout(200)
      check('R plays it again', await g(() => window.__actNatural.replay().running))
      await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
      check('next round clears the replay', await g(() => window.__actNatural.game.phase === 'round' && !window.__actNatural.replay().data))
    } else {
      check('with reduced motion the whole paths show at once', !r.running && r.progress === 1)
      await tv.keyboard.press('q'); await tv.waitForTimeout(300)
      await tv.screenshot({ path: S + '/replay-reduced-motion.png' })
    }
  }
  await run('no-preference')
  await run('reduce')
  check('no page errors ' + JSON.stringify(errs), errs.length === 0)
  await b.close(); process.exit(bad ? 1 : 0)
})().catch(e => { console.error('FAILED', e); process.exit(1) })
