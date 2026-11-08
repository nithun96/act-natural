const { chromium, devices } = require('playwright')
const base = (process.env.BASE || 'http://localhost:8765/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext()).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ph = {}
  for (const n of ['Ada', 'Bo', 'Cy']) { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad'); ph[n] = p }
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
  const phase = () => tv.evaluate(() => window.__actNatural.game.phase)
  const finishTasks = async (name) => { for (let i = 0; i < 3; i++) { await tv.evaluate(n => { const g = window.__actNatural.game; const p = [...g.players.values()].find(q => q.name === n); if (p.task.done >= 3) return; const lm = window.ActNatural.sim.LANDMARKS.find(l => l.id === p.task.tasks[p.task.done]); p.blob.x = lm.x; p.blob.y = lm.y }, name); await tv.waitForTimeout(1700) } }
  // Hiders finish first: Hunter still has shots → round goes on
  await finishTasks('Bo'); console.log('one hider done, one not → phase:', await phase())
  await finishTasks('Cy')
  console.log('all hiders done (shots left) → phase:', await phase(), await tv.evaluate(() => window.__actNatural.game.endReason))
  await b.close(); return
  // Hunter wastes shots on bots
  const shootBot = () => tv.evaluate(() => { const g = window.__actNatural.game; const humans = new Set([...g.players.values()].map(p => p.blob)); for (const [a, bl] of g.aliases) if (!humans.has(bl) && !bl.gone) { return g.shoot(g.hunter, a).type } })
  console.log(await shootBot(), await shootBot(), '→ phase with 1 shot left:', await phase())
  await shootBot(); await tv.waitForTimeout(300)
  console.log('0 shots left, everyone done → phase:', await phase(), '| reason:', await tv.evaluate(() => window.__actNatural.game.endReason))
  // Second round: shots used up but a hider unfinished → keep going
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(400)
  console.log('R2 hunter:', await tv.evaluate(() => window.__actNatural.game.hunter.name))
  for (let i = 0; i < 3; i++) await shootBot()
  await tv.waitForTimeout(300)
  console.log('0 shots, hiders unfinished → phase:', await phase())
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
