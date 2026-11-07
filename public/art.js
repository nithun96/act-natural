// Act Natural: how each landmark is drawn on the TV, in world units (the room is 1600 × 900).
// Drawn under the blobs, except `canopy`, which goes over them (tree tops, palm fronds).
// Simple flat shapes, so every map has the same look; the names under them say what they are.
(function () {
  'use strict'

  let ctx = null
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function circle (x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill() }
  function ellipse (x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill() }
  function rrect (x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  function box (x, y, w, h, r, fill) { rrect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill() }
  function poly (pts, fill) { ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill() }
  function line (pts, stroke, width) { ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke() }
  function ripple (x, y, from, span, t, colour) {
    if (reduceMotion) return
    const r = from + ((t * 14) % span)
    ctx.globalAlpha = 1 - (r - from) / span
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke()
    ctx.globalAlpha = 1
  }

  const K = {
    stone: '#6E665A', water: '#5E8BA0', waterLight: '#8DB4C4', wood: '#8A6A4A', woodLight: '#A8835A',
    leaf: '#5F7A4E', leafDark: '#4A6140', cream: '#E8DFC8', dark: '#1C1A17', shadow: 'rgba(0,0,0,0.35)',
    glow: 'rgba(240,210,140,0.10)', gold: '#C9A227', goldLight: '#E0B84A', red: '#A8483A', sand: '#B89C6E',
  }

  const DRAW = {
    // ---- The park ----
    fountain ({ x, y }, t) {
      circle(x, y, 70, K.stone); circle(x, y, 58, K.water)
      ripple(x, y, 20, 36, t, K.waterLight)
      circle(x, y, 14, K.stone)
    },
    lamp ({ x, y }) {
      circle(x, y, 90, K.glow); circle(x, y, 50, K.glow); circle(x, y, 12, '#F0D28C')
      ctx.strokeStyle = K.stone; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke()
    },
    bench ({ x, y }, t, floor) {
      box(x - 80, y - 16, 160, 32, 6, K.wood)
      for (let i = -1; i <= 1; i++) line([[x - 76, y + i * 9], [x + 76, y + i * 9]], floor, 3)
    },
    tree ({ x, y }) { circle(x + 8, y + 10, 64, K.shadow); circle(x, y, 18, K.wood) },
    rug ({ x, y }) {
      box(x - 110, y - 70, 220, 140, 10, '#A87A6A'); box(x - 98, y - 58, 196, 116, 6, '#7A4B5A')
      ctx.strokeStyle = '#A87A6A'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, 60, 32, 0, 0, Math.PI * 2); ctx.stroke()
    },

    // ---- Vietnam ----
    lake ({ x, y }, t) {                       // Hoan Kiem Lake with the Turtle Tower on its islet
      ellipse(x, y, 132, 82, K.stone); ellipse(x, y, 122, 72, '#4F7F8C')
      ripple(x - 40, y + 10, 14, 40, t, K.waterLight)
      ellipse(x + 34, y + 6, 26, 16, K.leaf)
      box(x + 24, y - 22, 20, 26, 2, '#D9CBB0')   // tower
      line([[x + 20, y - 22], [x + 48, y - 22]], '#7A5E44', 4)
      line([[x + 22, y - 12], [x + 46, y - 12]], '#7A5E44', 3)
    },
    pho ({ x, y }, t) {                        // a street stall: striped awning, table, stools, steaming bowl
      box(x - 70, y - 48, 140, 34, 4, '#B5523B')
      for (let i = -60; i <= 50; i += 22) box(x + i, y - 48, 11, 34, 0, '#E3C9A0')
      box(x - 55, y - 6, 110, 34, 4, K.wood)
      for (const sx of [-50, -15, 20, 55]) circle(x + sx, y + 44, 8, '#C25B3F')
      circle(x, y + 10, 11, K.cream); circle(x, y + 10, 7, '#C9A06A')
      if (!reduceMotion) for (const dx of [-5, 5]) {
        const k = Math.sin(t * 2 + dx)
        line([[x + dx, y], [x + dx + k * 3, y - 10], [x + dx - k * 3, y - 20]], 'rgba(232,223,200,0.5)', 2)
      }
    },
    lanterns ({ x, y }, t) {                   // a string of silk lanterns
      line([[x - 120, y - 30], [x - 60, y - 12], [x, y - 6], [x + 60, y - 12], [x + 120, y - 30]], '#5A4632', 2)
      const colours = ['#C8553D', '#E0A458', '#8F5FD0', '#5E8BA0', '#C8553D', '#E0A458', '#8F5FD0']
      colours.forEach((c, i) => {
        const lx = x - 108 + i * 36
        const ly = y - 30 + Math.abs(Math.sin((i / 6) * Math.PI)) * 22
        circle(lx, ly + 12, 22, 'rgba(240,190,120,0.10)')
        ellipse(lx, ly + 12, 11, 15, c)
        line([[lx - 6, ly - 3], [lx + 6, ly - 3]], '#3A2C20', 3)
      })
    },
    paddy ({ x, y }) {                          // flooded rice field in rows, with a nón lá (conical hat)
      box(x - 115, y - 72, 230, 144, 6, '#3E5B3A')
      for (let r = -56; r <= 56; r += 16) line([[x - 108, y + r], [x + 108, y + r]], '#6E8C55', 4)
      line([[x - 115, y - 72], [x + 115, y - 72]], '#8A7652', 6)
      circle(x + 60, y + 20, 15, '#D9C38E'); circle(x + 60, y + 20, 4, '#A88A55')
    },
    motorbike ({ x, y }) {                      // a scooter seen from above, with a helmet on the seat
      ellipse(x - 50, y, 16, 10, '#2A2A2A'); ellipse(x + 50, y, 16, 10, '#2A2A2A')
      box(x - 50, y - 15, 100, 30, 14, '#B5523B')
      box(x - 18, y - 11, 44, 22, 10, '#3A2C20')
      line([[x + 46, y - 26], [x + 46, y + 26]], '#9A9A9A', 5)
      circle(x - 4, y, 9, '#E0A458')
    },

    // ---- Jaffna ----
    temple ({ x, y }) {                         // Nallur Kandaswamy: red-and-white striped wall, golden tower
      box(x - 110, y - 10, 220, 60, 3, K.cream)
      for (let i = -104; i < 104; i += 18) box(x + i, y - 10, 9, 60, 0, '#B5483A')
      const tiers = [[90, 20], [74, 18], [58, 16], [42, 14], [28, 12]]
      let ty = y - 10
      tiers.forEach(([w, h], i) => { ty -= h; box(x - w / 2, ty, w, h, 2, i % 2 ? K.goldLight : K.gold) })
      circle(x, ty - 6, 7, K.goldLight)
      box(x - 16, y + 20, 32, 30, 3, '#5A3A28')   // doorway
    },
    beach ({ x, y }, t) {                       // Casuarina Beach: sand, shallow water, casuarina trees
      ellipse(x, y, 130, 84, K.sand)
      ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, 130, 84, 0, 0, Math.PI * 2); ctx.clip()
      box(x - 140, y - 100, 280, 56, 0, '#4F8A9C')
      if (!reduceMotion) line([[x - 130, y - 42 + Math.sin(t) * 3], [x - 40, y - 46 + Math.sin(t + 1) * 3], [x + 50, y - 42 + Math.sin(t + 2) * 3], [x + 130, y - 46]], '#B9D6DE', 3)
      ctx.restore()
      for (const [dx, dy] of [[-70, 30], [70, 34]]) { circle(x + dx, y + dy, 16, '#4A6140'); circle(x + dx, y + dy - 10, 11, '#5F7A4E') }
    },
    library ({ x, y }) {                        // white building with a central dome and arched windows
      box(x - 95, y - 22, 190, 46, 3, '#E4DDCB')
      ctx.beginPath(); ctx.arc(x, y - 22, 26, Math.PI, 0); ctx.fillStyle = '#EFE9DA'; ctx.fill()
      for (const dx of [-70, -46, 46, 70]) { box(x + dx - 7, y - 10, 14, 22, 7, '#7A8C96') }
      box(x - 12, y - 4, 24, 28, 3, '#6E5A44')
    },
    palm ({ x, y }) { circle(x + 6, y + 8, 56, K.shadow); circle(x, y, 14, '#5A4632') },
    fort ({ x, y }) {                           // Jaffna Fort: a five-pointed star of stone walls
      const star = (r1, r2) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? r2 : r1; p.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8]) } return p }
      poly(star(110, 70), '#6F675C')
      poly(star(92, 58), '#3F5236')
      box(x - 20, y - 14, 40, 28, 3, '#6F675C')
    },

    // ---- East Oslo ----
    senter ({ x, y }) {                         // Stovner senter: a low shopping centre with a sign
      box(x - 130, y - 50, 260, 100, 6, '#5A5F66')
      box(x - 130, y - 50, 260, 24, 6, '#3E4248')
      ctx.fillStyle = K.cream; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('STOVNER SENTER', x, y - 38)
      for (let i = -110; i < 110; i += 30) box(x + i, y - 16, 22, 30, 2, '#8FA6B3')
      box(x - 20, y + 22, 40, 28, 2, '#A9C1CC')
    },
    tbane ({ x, y }) {                          // Haugenstua: a metro platform, two tracks and a T sign
      box(x - 115, y - 30, 230, 26, 3, '#7A7E84')
      for (const ty of [8, 30]) {
        line([[x - 125, y + ty - 5], [x + 125, y + ty - 5]], '#9A9A9A', 2)
        line([[x - 125, y + ty + 5], [x + 125, y + ty + 5]], '#9A9A9A', 2)
        for (let i = -120; i <= 120; i += 16) line([[x + i, y + ty - 7], [x + i, y + ty + 7]], '#5A4632', 3)
      }
      circle(x - 80, y - 42, 15, K.cream); circle(x - 80, y - 42, 12, '#2F5D8A')
      ctx.fillStyle = K.cream; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('T', x - 80, y - 41)
    },
    tower ({ x, y }) {                          // Stovnertårnet: a ring-shaped walkway above the forest
      for (const [dx, dy, r] of [[-60, -40, 26], [55, -45, 24], [-70, 35, 24], [65, 38, 26], [0, 60, 22], [0, -66, 22]]) circle(x + dx, y + dy, r, '#3E5A36')
      ctx.beginPath(); ctx.arc(x, y, 62, 0, Math.PI * 2); ctx.strokeStyle = '#A8835A'; ctx.lineWidth = 12; ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, 62, 0, Math.PI * 2); ctx.strokeStyle = '#7A5E44'; ctx.lineWidth = 2; ctx.stroke()
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; circle(x + Math.cos(a) * 62, y + Math.sin(a) * 62, 4, '#5A4632') }
    },
    pitch ({ x, y }) {                          // a football pitch on artificial grass
      box(x - 115, y - 72, 230, 144, 4, '#3F6B3F')
      ctx.strokeStyle = 'rgba(232,223,200,0.8)'; ctx.lineWidth = 3
      ctx.strokeRect(x - 105, y - 62, 210, 124)
      line([[x, y - 62], [x, y + 62]], 'rgba(232,223,200,0.8)', 3)
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeRect(x - 105, y - 22, 18, 44); ctx.strokeRect(x + 87, y - 22, 18, 44)
    },
    blocks ({ x, y }) {                         // a block of flats, some windows lit
      box(x - 105, y - 58, 210, 116, 4, '#4A4E55')
      let n = 0
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
        n = (n * 7 + 3) % 11
        box(x - 95 + c * 22, y - 50 + r * 21, 13, 12, 1, n < 4 ? '#F0D28C' : '#2E3136')
      }
    },

    // ---- Ålesund ----
    canal ({ x, y }, t) {                       // Brosundet: a narrow canal between stone quays, boats moored
      box(x - 140, y - 46, 280, 20, 2, '#5E5A55')
      box(x - 140, y + 26, 280, 20, 2, '#5E5A55')
      box(x - 140, y - 26, 280, 52, 0, '#3F6E80')
      if (!reduceMotion) line([[x - 130, y + Math.sin(t) * 2], [x - 40, y + 4 + Math.sin(t + 1) * 2], [x + 50, y + Math.sin(t + 2) * 2], [x + 130, y + 4]], '#6E9AAB', 2)
      for (const [bx, c] of [[-80, '#E8DFC8'], [10, '#B5523B'], [90, '#E8DFC8']]) {
        poly([[x + bx - 24, y - 12], [x + bx + 18, y - 12], [x + bx + 28, y - 2], [x + bx + 18, y + 8], [x + bx - 24, y + 8]], c)
        box(x + bx - 10, y - 8, 14, 10, 2, '#3A2C20')
      }
    },
    harbour ({ x, y }, t) {                     // Steinvågen: a small cove, a breakwater and sjøhus on the edge
      ellipse(x + 10, y + 14, 115, 48, '#3F6E80')
      ripple(x + 30, y + 20, 10, 30, t, '#6E9AAB')
      line([[x - 100, y + 52], [x + 30, y + 64], [x + 110, y + 50]], '#6F675C', 10)   // breakwater
      for (const [dx, c] of [[-110, '#A8483A'], [-62, '#C9963F'], [-14, '#A8483A']]) {
        box(x + dx, y - 54, 40, 34, 2, c)
        poly([[x + dx - 4, y - 54], [x + dx + 20, y - 74], [x + dx + 44, y - 54]], '#3A2C20')
        box(x + dx + 14, y - 36, 12, 16, 1, '#2A211A')
      }
      poly([[x + 40, y + 8], [x + 72, y + 8], [x + 80, y + 16], [x + 72, y + 24], [x + 40, y + 24]], K.cream)
    },
    hill ({ x, y }) {                           // Aksla: a green hill, the stairs up its side, Fjellstua on top
      ellipse(x, y + 6, 120, 74, '#3E5A36')
      ellipse(x - 6, y - 2, 92, 56, '#4A6B40')
      ellipse(x - 10, y - 10, 58, 36, '#5F7F4E')
      line([[x + 96, y + 52], [x + 70, y + 34], [x + 84, y + 18], [x + 56, y + 4], [x + 66, y - 12], [x + 30, y - 22]], '#C9BDA3', 4)
      box(x - 34, y - 32, 48, 22, 2, '#E4DDCB')
      poly([[x - 38, y - 32], [x - 10, y - 46], [x + 18, y - 32]], '#3A3E44')
    },
    jugend ({ x, y }) {                         // Aspøya: a row of Art Nouveau facades with turrets
      const fronts = ['#D8C27A', '#A9C3A0', '#D9967E', '#9FB8CC', '#E4DDCB']
      fronts.forEach((c, i) => {
        const fx = x - 125 + i * 50
        box(fx, y - 30, 46, 64, 2, c)
        if (i % 2) poly([[fx + 6, y - 30], [fx + 23, y - 62], [fx + 40, y - 30]], '#4A4E55')
        else { poly([[fx, y - 30], [fx + 23, y - 48], [fx + 46, y - 30]], '#4A4E55'); poly([[fx + 30, y - 30], [fx + 37, y - 60], [fx + 44, y - 30]], '#3A3E44') }
        for (let r = 0; r < 3; r++) for (let w = 0; w < 2; w++) box(fx + 9 + w * 18, y - 22 + r * 18, 9, 11, 4, '#2E3136')
      })
    },
    cove ({ x, y }, t) {                        // Skarbøvika: a pale beach curving round the sea, rocks at the edge
      ellipse(x, y + 4, 130, 80, '#D2C29C')
      ctx.save(); ctx.beginPath(); ctx.ellipse(x, y + 4, 130, 80, 0, 0, Math.PI * 2); ctx.clip()
      ellipse(x, y - 52, 150, 74, '#3F6E80')
      if (!reduceMotion) line([[x - 130, y + 18 + Math.sin(t) * 3], [x - 45, y + 24 + Math.sin(t + 1) * 3], [x + 45, y + 24 + Math.sin(t + 2) * 3], [x + 130, y + 18 + Math.sin(t + 3) * 3]], '#B9D6DE', 3)
      ctx.restore()
      for (const [dx, dy, r] of [[-100, 30, 14], [-82, 46, 10], [96, 34, 16], [110, 18, 9]]) circle(x + dx, y + dy, r, '#7A7E84')
    },
  }

  const CANOPY = {
    tree ({ x, y }) {
      ctx.globalAlpha = 0.88
      circle(x - 26, y - 14, 42, K.leafDark); circle(x + 24, y - 18, 40, K.leafDark); circle(x, y + 16, 44, K.leafDark)
      circle(x - 6, y - 8, 40, K.leaf); circle(x + 18, y + 6, 30, K.leaf)
      ctx.globalAlpha = 1
    },
    palm ({ x, y }) {                           // fan-shaped palmyra leaves
      ctx.globalAlpha = 0.85
      for (let i = 0; i < 9; i++) {
        const a = i * Math.PI * 2 / 9
        const ex = x + Math.cos(a) * 52, ey = y + Math.sin(a) * 52
        poly([[x, y], [ex + Math.cos(a + 1.3) * 18, ey + Math.sin(a + 1.3) * 18], [ex + Math.cos(a - 1.3) * 18, ey + Math.sin(a - 1.3) * 18]], i % 2 ? '#4E6B3A' : '#5F7F45')
      }
      circle(x, y, 10, '#5A4632')
      ctx.globalAlpha = 1
    },
  }

  function draw (c, lm, t, floor) { ctx = c; (DRAW[lm.kind] || (() => {}))(lm, t, floor) }
  function canopy (c, lm) { ctx = c; if (CANOPY[lm.kind]) CANOPY[lm.kind](lm) }
  function label (c, lm, colour) {
    ctx = c
    ctx.font = 'italic 26px Georgia, serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = colour
    ctx.fillText(lm.name, lm.x, lm.y + (lm.below || 60))
  }

  window.ActNatural = Object.assign(window.ActNatural || {}, { art: { draw, canopy, label } })
})()
