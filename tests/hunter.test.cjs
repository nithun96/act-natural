const { chromium, devices } = require('playwright')
const S = process.argv[2] || require('path').join(__dirname, 'out'); const base = (process.env.BASE || 'http://localhost:8765/'); const sig = '&signal=127.0.0.1:9000'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const tv = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); tv.on('pageerror', e => errs.push('tv ' + e.message))
  await tv.goto(base + '?host' + sig); await tv.waitForSelector('.lobby .code'); const code = await tv.textContent('.lobby .code')
  const ph = {}
  const join = async n => { const p = await (await b.newContext(devices['iPhone 13'])).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); await p.goto(base + '?room=' + code + sig); await p.fill('#name', n); await p.click('button[type=submit]'); await p.waitForSelector('#pad, #hmap, .card', { timeout: 20000 }); ph[n] = p; return p }
  for (const n of ['Ada', 'Bo', 'Cy']) await join(n)
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(700)
  const A = ph.Ada; await A.waitForSelector('#hmap')
  const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim()
  const g = (f, a) => tv.evaluate(f, a)
  console.log('start shots:', await txt(A, '#shots'))
  // recharge: nudge the clock towards the next shot (test only)
  for (let i = 0; i < 3; i++) { await g(() => { window.__actNatural.game.recharge = 19.7 }); await A.waitForTimeout(700) }
  console.log('after 3 recharges (max 3):', await txt(A, '#shots'), '| game.shots', await g(() => window.__actNatural.game.shots))
  // helpers to pick blobs that stand apart so a tap hits the intended one
  const pick = (kind) => g(k => { const G = window.__actNatural.game; const hum = new Map([...G.players.values()].map(p => [p.blob, p.name])); const live = [...G.aliases.values()].filter(x => !x.out && !x.gone && !x.hidden)
    const sep = x => Math.min(...live.filter(y => y !== x).map(y => Math.hypot(x.x - y.x, x.y - y.y)))
    const c = live.filter(x => k === 'bot' ? !hum.has(x) : hum.get(x) === k).sort((p, q) => sep(q) - sep(p))[0]; return c ? c.id : null }, kind)
  const aimAt = async (id) => { for (let t = 0; t < 4; t++) { const pos = await g(i => { const x = window.__actNatural.world.blobs.find(z => z.id === i); return { x: x.x / 1600, y: x.y / 900 } }, id); const r = await A.$eval('#hmap', e => { const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height } }); await A.dispatchEvent('#hmap', 'pointerdown', { clientX: r.x + pos.x * r.w, clientY: r.y + pos.y * r.h, pointerId: 7, isPrimary: true }); await A.waitForTimeout(250); if (await g(i => window.__actNatural.game.aim && window.__actNatural.game.aim.id === i, id)) return true } return false }
  // miss → lock
  const bot1 = await pick('bot'); console.log('aim bot:', await aimAt(bot1))
  await A.click('#shoot'); await A.waitForTimeout(400)
  console.log('after bot shot: toast:', await txt(A, '#toast'), '| button:', await txt(A, '#shoot'), 'disabled', await A.$eval('#shoot', e => e.disabled))
  await tv.screenshot({ path: S + '/hunter-tv-locked.png' })
  await A.waitForTimeout(5300)
  const other = await pick('bot'); await aimAt(other)
  console.log('after 5 s: button:', await txt(A, '#shoot'), 'disabled', await A.$eval('#shoot', e => e.disabled))
  // marks
  const marked = []
  for (const k of ['bot', 'Bo', 'Cy']) { const id = await pick(k); await aimAt(id); await A.click('#mark'); await A.waitForTimeout(250); marked.push(id) }
  console.log('marks on TV:', JSON.stringify(await g(() => [...window.__actNatural.game.marks].map(([b, n]) => n))))
  const extra = await g(ids => { const G = window.__actNatural.game; return [...G.aliases.values()].find(x => !x.out && !x.gone && !ids.includes(x.id) && ![...G.players.values()].some(p => p.blob === x)).id }, marked)
  await aimAt(extra); await A.click('#mark'); await A.waitForTimeout(300)
  console.log('4th mark → toast:', await txt(A, '#toast'), '| marks', await g(() => window.__actNatural.game.marks.size))
  await aimAt(marked[1]); console.log('mark button on suspect 2:', await txt(A, '#mark'))
  await tv.screenshot({ path: S + '/hunter-tv-marks.png' }); await A.screenshot({ path: S + '/hunter-phone.png' })
  await A.click('#mark'); await A.waitForTimeout(250)
  console.log('after unmarking 2:', JSON.stringify(await g(() => [...window.__actNatural.game.marks.values()].sort())))
  await aimAt(extra); await A.click('#mark'); await A.waitForTimeout(250)
  console.log('new mark takes the free number:', JSON.stringify(await g(() => [...window.__actNatural.game.marks.values()].sort())))
  // catch marked Cy → mark gone
  const cy = marked[2]; await aimAt(cy); await A.click('#shoot'); await A.waitForTimeout(400)
  console.log('caught Cy, Cy still marked?', await g(i => [...window.__actNatural.game.marks.keys()].some(b => b.id === i), cy), '| toast:', await txt(A, '#toast'))
  // mid-round join keeps aliases and aim
  const keep = await pick('Bo'); await aimAt(keep)
  const before = await g(() => JSON.stringify([...window.__actNatural.game.aliases].map(([a, b]) => [a, b.id])))
  await join('Dee'); await tv.waitForTimeout(400)
  const after = await g(() => [...window.__actNatural.game.aliases].map(([a, b]) => [a, b.id]))
  const prev = JSON.parse(before); const kept = prev.every(([a, id]) => after.some(([a2, id2]) => a2 === a && id2 === id))
  console.log('mid-round join: old aliases kept', kept, '| new', after.length - prev.length, '| aim kept', await g(i => window.__actNatural.game.aim && window.__actNatural.game.aim.id === i, keep))
  // early end: every hider still in finishes
  for (const n of ['Bo', 'Dee']) for (let i = 0; i < 3; i++) { await g(nm => { const G = window.__actNatural.game; const p = [...G.players.values()].find(q => q.name === nm); if (p.task.done >= 3) return; const lm = window.ActNatural.sim.LANDMARKS.find(l => l.id === p.task.tasks[p.task.done]); p.blob.x = lm.x; p.blob.y = lm.y }, n); await tv.waitForTimeout(1700) }
  console.log('all done → phase', await g(() => window.__actNatural.game.phase), await g(() => window.__actNatural.game.endReason), '| TV:', (await txt(tv, '.lobby .why')))
  console.log('errors', errs); await b.close()
})().catch(e => { console.error('FAILED', e); process.exit(1) })
