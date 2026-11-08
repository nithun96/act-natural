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
    lampa ({ x, y }, t) {                       // Haugenstua Lampa: a tall street lamp with a wide warm glow
      const pulse = reduceMotion ? 1 : 1 + Math.sin(t * 1.5) * 0.04
      for (const [r, a] of [[118, 0.06], [88, 0.08], [58, 0.10], [32, 0.14]]) circle(x, y, r * pulse, `rgba(240,210,140,${a})`)
      circle(x + 4, y + 6, 10, K.shadow)
      circle(x, y, 9, '#2E3136')                // post seen from above
      line([[x, y], [x + 24, y - 12]], '#2E3136', 5)   // arm
      ellipse(x + 30, y - 15, 15, 10, '#3A3E44')
      ellipse(x + 30, y - 15, 10, 6, '#F6DE9C')        // lamp head
    },
    kovil ({ x, y }) {                          // Rommen Hindu Temple: white hall, striped base, small pastel gopuram
      box(x - 105, y - 22, 210, 56, 3, '#EDE6D6')              // flat-roofed hall
      for (let i = -100; i < 100; i += 14) box(x + i, y + 22, 7, 12, 0, '#B5483A')   // red-and-white base wall
      line([[x - 105, y - 22], [x + 105, y - 22]], '#C9BFA8', 3)
      const tiers = [[56, 14, '#E8A0B4'], [46, 12, '#6FC2BE'], [36, 11, '#E8C860'], [26, 10, '#E8A0B4']]
      let ty = y - 22
      for (const [w, h, c] of tiers) { ty -= h; box(x - w / 2, ty, w, h, 2, c); line([[x - w / 2, ty + h], [x + w / 2, ty + h]], '#8A7652', 1.5) }
      circle(x, ty - 5, 5, K.goldLight)                        // kalasam on top
      box(x - 13, y - 2, 26, 36, 3, '#6E4A32')                 // doorway
      for (const dx of [-70, -42, 42, 70]) box(x + dx - 7, y - 10, 14, 18, 7, '#9AAAB2')
    },
    // ---- Ålesund ----
    canal ({ x, y }, t) {                       // Brosundet: canal lined on both sides by pastel warehouse fronts (pakkhus), boats, Hellebrua across
      const fronts = ['#C98B6B', '#D9C27A', '#8FB0A6', '#C7A0B4', '#9DB3CC', '#E0D2B4']
      for (const [row, top] of [[0, y - 84], [1, y + 44]]) {      // building fronts on each quay
        for (let i = 0; i < 6; i++) {
          const bx = x - 138 + i * 46
          box(bx, top, 42, 38, 2, fronts[(i + row * 3) % 6])
          poly([[bx - 2, top], [bx + 21, top - 14], [bx + 44, top]], '#4A3E36')   // gable
          for (const wx of [8, 26]) box(bx + wx, top + 10, 8, 10, 3, '#3E4148')
        }
      }
      box(x - 140, y - 46, 280, 14, 2, '#6A645C')                // stone quays
      box(x - 140, y + 30, 280, 14, 2, '#6A645C')
      box(x - 140, y - 32, 280, 62, 0, '#3F6E80')                // water
      if (!reduceMotion) line([[x - 130, y + Math.sin(t) * 2], [x - 40, y + 4 + Math.sin(t + 1) * 2], [x + 50, y + Math.sin(t + 2) * 2], [x + 130, y + 4]], '#6E9AAB', 2)
      for (const [bx, by, c] of [[-100, -20, '#E8DFC8'], [-40, 10, '#B5523B'], [90, -18, '#E8DFC8']]) {   // moored boats
        poly([[x + bx - 22, y + by], [x + bx + 16, y + by], [x + bx + 25, y + by + 7], [x + bx + 16, y + by + 14], [x + bx - 22, y + by + 14]], c)
        box(x + bx - 8, y + by + 3, 12, 8, 2, '#3A2C20')
      }
      box(x + 22, y - 36, 34, 70, 2, '#8A8378')                  // Hellebrua, a bridge across the canal
      line([[x + 22, y - 36], [x + 22, y + 34]], '#5E5850', 3)
      line([[x + 56, y - 36], [x + 56, y + 34]], '#5E5850', 3)
    },
    harbour ({ x, y }, t) {                     // Steinvågen: the sound between Aspøya and Hessa, Steinvågbrua's concrete arch, a breakwater
      box(x - 125, y - 40, 250, 70, 6, '#3F6E80')               // the sound
      ripple(x - 60, y + 4, 10, 30, t, '#6E9AAB')
      box(x - 130, y - 62, 260, 22, 3, '#5C5650')               // land, Aspøya side
      box(x - 130, y + 30, 260, 20, 3, '#5C5650')               // land, Hessa side
      box(x + 6, y - 66, 44, 120, 2, '#B9B4AA')                 // Steinvågbrua deck, 1953 concrete
      ctx.beginPath(); ctx.ellipse(x + 28, y - 4, 50, 30, 0, Math.PI * 0.08, Math.PI * 0.92, true); ctx.strokeStyle = '#8F8A80'; ctx.lineWidth = 6; ctx.stroke()   // the arch under it
      line([[x - 120, y + 26], [x - 70, y + 14], [x - 30, y + 18]], '#6F675C', 9)   // breakwater
      poly([[x + 70, y - 18], [x + 100, y - 18], [x + 108, y - 11], [x + 100, y - 4], [x + 70, y - 4]], K.cream)   // a small boat
    },
    cove ({ x, y }, t) {                        // Skarbøvika on Hessa: a rocky shore (fjære) between sea and hillside, houses above
      ellipse(x - 10, y - 66, 130, 34, '#3E5236')               // hillside behind
      box(x - 125, y - 54, 250, 54, 4, '#4E5A44')               // land
      for (const [dx, c] of [[-90, '#C9C1AE'], [-50, '#A8483A'], [-10, '#D8D2C2'], [30, '#9DB3CC']]) {   // houses on the slope
        box(x + dx, y - 50, 26, 20, 2, c)
        poly([[x + dx - 3, y - 50], [x + dx + 13, y - 62], [x + dx + 29, y - 50]], '#3A3530')
      }
      box(x - 125, y, 250, 58, 4, '#3F6E80')                    // sea
      if (!reduceMotion) line([[x - 120, y + 8 + Math.sin(t) * 3], [x - 40, y + 12 + Math.sin(t + 1) * 3], [x + 40, y + 12 + Math.sin(t + 2) * 3], [x + 120, y + 8 + Math.sin(t + 3) * 3]], '#B9D6DE', 3)
      for (const [dx, dy, r] of [[-110, 0, 13], [-88, 6, 9], [-60, -2, 11], [-30, 4, 8], [0, -1, 12], [32, 5, 9], [62, 0, 13], [92, 4, 10], [114, -2, 8]]) circle(x + dx, y + dy, r, '#7A7E84')   // the rocky shore, no sand
    },
    school ({ x, y }) {                         // Aspøy skole (1922): large yellow, symmetrical, slate half-hipped roof, central tower with onion dome and spire
      box(x - 120, y - 20, 240, 62, 3, '#D9B54A')               // three storeys, yellow
      poly([[x - 124, y - 20], [x - 104, y - 44], [x + 104, y - 44], [x + 124, y - 20]], '#4A4E55')   // slate half-hipped roof
      for (const dx of [-80, -40, 40, 80]) box(x + dx - 6, y - 40, 12, 10, 2, '#D9B54A')   // dormers in the roof
      box(x - 14, y - 70, 28, 28, 2, '#D9B54A')                 // central tower
      poly([[x - 17, y - 70], [x, y - 78], [x + 17, y - 70]], '#4A4E55')   // low hipped tower roof
      ellipse(x, y - 88, 9, 12, '#5E7466')                      // elongated onion dome
      line([[x, y - 100], [x, y - 114]], '#3A3530', 3)          // spire
      for (const row of [-12, 4, 20]) for (const dx of [-108, -88, -68, -48, 36, 56, 76, 96]) box(x + dx, y + row, 12, 11, 1, '#3E3A33')   // symmetrical window rows
      box(x - 18, y - 14, 36, 56, 3, '#E3C565')                 // ornamented central bay
      box(x - 10, y + 16, 20, 26, 9, '#6E4A32')                 // central entrance
      line([[x - 18, y + 8], [x + 18, y + 8]], '#B8922E', 3)
    },
    jugendcentre ({ x, y }) {                   // Jugendstilsenteret (old Swan pharmacy): corner building, round tower with a spire
      box(x - 100, y - 30, 150, 64, 3, '#D8CDB4')               // stone-coloured facade
      line([[x - 102, y - 30], [x + 50, y - 30]], '#4A3E36', 6)  // darker roof line
      line([[x - 100, y - 12], [x + 50, y - 12]], '#A8977A', 2)  // ornamental band
      for (const dx of [-88, -62, -36, -10, 16]) { box(x + dx, y - 4, 16, 22, 8, '#3E4148'); box(x + dx, y - 28, 16, 12, 6, '#3E4148') }   // curved-top windows
      circle(x + 62, y + 2, 34, '#CFC2A6')                      // round corner tower
      ctx.beginPath(); ctx.arc(x + 62, y + 2, 34, 0, Math.PI * 2); ctx.strokeStyle = '#A8977A'; ctx.lineWidth = 3; ctx.stroke()
      for (const a of [-2.2, -1.2, -0.2]) box(x + 62 + Math.cos(a) * 20 - 6, y + 2 + Math.sin(a) * 20 - 8, 12, 16, 6, '#3E4148')
      circle(x + 62, y - 14, 11, K.cream); ctx.beginPath(); ctx.arc(x + 62, y - 14, 11, 0, Math.PI * 2); ctx.strokeStyle = '#4A3E36'; ctx.lineWidth = 2; ctx.stroke()   // the clock
      line([[x + 62, y - 14], [x + 62, y - 21]], '#4A3E36', 2); line([[x + 62, y - 14], [x + 67, y - 14]], '#4A3E36', 2)
      poly([[x + 38, y - 26], [x + 62, y - 86], [x + 86, y - 26]], '#4A5A52')   // spire on the roof
      line([[x + 62, y - 86], [x + 62, y - 98]], '#4A3E36', 3)
      circle(x + 62, y - 100, 3, '#C9A227')
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
