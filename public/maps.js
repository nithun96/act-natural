// Act Natural: the maps. Each one puts its own five landmarks on the same five spots in the
// room (centre, top left, top right, bottom right, bottom left), so every map plays the same.
// `kind` picks the drawing in art.js; `below` is how far under the centre the name goes.
(function () {
  'use strict'

  const SPOTS = {
    centre: { x: 800, y: 450 },
    tl: { x: 260, y: 210 },
    tr: { x: 1330, y: 190 },
    br: { x: 1350, y: 700 },
    bl: { x: 300, y: 690 },
  }
  const at = (spot, lm) => Object.assign({}, SPOTS[spot], lm)

  const MAPS = [
    {
      id: 'park',
      name: 'The park',
      colours: { floor: '#1F1C18', floorLine: '#2A2621', wall: '#3A342C' },
      landmarks: [
        at('centre', { id: 'fountain', name: 'Fountain', kind: 'fountain', below: 96 }),
        at('tl', { id: 'lamp', name: 'Lamp', kind: 'lamp', below: 40 }),
        at('tr', { id: 'bench', name: 'Bench', kind: 'bench', below: 42 }),
        at('br', { id: 'tree', name: 'Tree', kind: 'tree', below: 84 }),
        at('bl', { id: 'rug', name: 'Rug', kind: 'rug', below: 94 }),
      ],
    },
    {
      id: 'vietnam',
      name: 'Vietnam',
      colours: { floor: '#251F18', floorLine: '#30281E', wall: '#4A3B2A' },
      landmarks: [
        at('centre', { id: 'hoankiem', name: 'Hoan Kiem Lake', kind: 'lake', below: 104 }),
        at('tl', { id: 'pho', name: 'Phở stall', kind: 'pho', below: 66 }),
        at('tr', { id: 'lanterns', name: 'Hội An lanterns', kind: 'lanterns', below: 58 }),
        at('br', { id: 'paddy', name: 'Rice paddy', kind: 'paddy', below: 96 }),
        at('bl', { id: 'motorbike', name: 'Motorbike', kind: 'motorbike', below: 62 }),
      ],
    },
    {
      id: 'jaffna',
      name: 'Jaffna',
      colours: { floor: '#291C17', floorLine: '#35251E', wall: '#4E3226' },
      landmarks: [
        at('centre', { id: 'nallur', name: 'Nallur Kandaswamy', kind: 'temple', below: 92 }),
        at('tl', { id: 'casuarina', name: 'Casuarina Beach', kind: 'beach', below: 104 }),
        at('tr', { id: 'library', name: 'Jaffna Public Library', kind: 'library', below: 56 }),
        at('br', { id: 'palmyra', name: 'Palmyra palm', kind: 'palm', below: 84 }),
        at('bl', { id: 'fort', name: 'Jaffna Fort', kind: 'fort', below: 104 }),
      ],
    },
    {
      id: 'stovner',
      name: 'East Oslo',
      colours: { floor: '#1C1E21', floorLine: '#26292D', wall: '#3A3E44' },
      landmarks: [
        at('centre', { id: 'senter', name: 'Stovner senter', kind: 'senter', below: 82 }),
        at('tl', { id: 'haugenstua', name: 'Haugenstua T', kind: 'tbane', below: 62 }),
        at('tr', { id: 'tarnet', name: 'Stovnertårnet', kind: 'tower', below: 96 }),
        at('br', { id: 'pitch', name: 'Football pitch', kind: 'pitch', below: 96 }),
        at('bl', { id: 'blocks', name: 'The blocks', kind: 'blocks', below: 78 }),
      ],
    },
    {
      id: 'alesund',
      name: 'Ålesund',
      colours: { floor: '#1B2125', floorLine: '#252C31', wall: '#38424A' },
      landmarks: [
        at('centre', { id: 'brosundet', name: 'Brosundet', kind: 'canal', below: 84 }),
        at('tl', { id: 'steinvagen', name: 'Steinvågen', kind: 'harbour', below: 92 }),
        at('tr', { id: 'aksla', name: 'Aksla', kind: 'hill', below: 96 }),
        at('br', { id: 'aspoya', name: 'Aspøya', kind: 'jugend', below: 70 }),
        at('bl', { id: 'skarbovika', name: 'Skarbøvika', kind: 'cove', below: 108 }),
      ],
    },
  ]

  const byId = id => MAPS.find(m => m.id === id) || MAPS[0]

  window.ActNatural = Object.assign(window.ActNatural || {}, { maps: { list: MAPS, byId } })
})()
