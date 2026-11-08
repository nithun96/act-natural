// Builds the game into dist/: the files in public/ as they are, the two libraries from
// node_modules into dist/vendor/ (the CSP only allows the site's own scripts), and turn.js,
// the relay (TURN) login. No bundler: the game is plain HTML, JS and canvas.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createHmac } from 'crypto'

const root = new URL('..', import.meta.url)
const dist = new URL('dist/', root)
rmSync(dist, { recursive: true, force: true })
cpSync(new URL('public/', root), dist, { recursive: true })

const VENDOR = {
  'peerjs.min.js': ['peerjs/dist/peerjs.min.js', s => s.replace(/\/\/# sourceMappingURL=\S+\s*$/, '')],
  'qrcode.js': ['qrcode-generator/dist/qrcode.js'],
  'LICENSE-peerjs.txt': ['peerjs/LICENSE'],
}
mkdirSync(new URL('vendor/', dist), { recursive: true })
for (const [name, [file, fix]] of Object.entries(VENDOR)) {
  const text = readFileSync(new URL(`node_modules/${file}`, root), 'utf-8')
  writeFileSync(new URL(`vendor/${name}`, dist), fix ? fix(text) : text)
}

// The relay login, made fresh at each build from the secret the relay on the server shares
// (TURN_SECRET; see server/turn/README.md). TURN REST scheme: the username holds an expiry
// time and the password is an HMAC of it, so the secret never reaches the page and each
// login stops working after 60 days. Without the secret the game has no relay of its own.
const TURN_TTL_DAYS = 60
const secret = process.env.TURN_SECRET
const host = process.env.TURN_HOST || 'play.nithun.no'
let turn = 'window.ActNatural = Object.assign(window.ActNatural || {}, { turn: null })\n'
if (secret) {
  const expires = Math.floor(Date.now() / 1000) + TURN_TTL_DAYS * 86400
  const username = `${expires}:actnatural`
  const credential = createHmac('sha1', secret).update(username).digest('base64')
  turn = '// Made at build time by scripts/build.js. Expires ' + new Date(expires * 1000).toISOString().slice(0, 10) + '.\n' +
    `window.ActNatural = Object.assign(window.ActNatural || {}, { turn: ${JSON.stringify({ host, username, credential, expires })} })\n`
}
writeFileSync(new URL('turn.js', dist), turn)
console.log(`build: dist/ ready${secret ? ` (relay login for ${host})` : ' (no TURN_SECRET: no relay login)'}`)
