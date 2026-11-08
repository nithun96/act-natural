// npm test: builds the game, starts a static server for dist/ and a local PeerJS server,
// then runs every *.test.cjs headlessly (Playwright's Chromium) against them.
// Needs Chromium for Playwright: `npx playwright install chromium` once.
import { spawn, execFileSync } from 'child_process'
import { mkdirSync, readdirSync } from 'fs'

const here = new URL('.', import.meta.url).pathname
mkdirSync(here + 'out', { recursive: true })
execFileSync('node', [here + '../scripts/build.js'], { stdio: 'inherit' })
const server = spawn('node', [here + '../scripts/serve.js', '8765'], { stdio: 'ignore' })
const peer = spawn('node', [here + 'peer-server.cjs'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1500))

let failed = 0
for (const file of readdirSync(here).filter(f => f.endsWith('.test.cjs')).sort()) {
  const code = await new Promise(resolve => {
    const t = spawn('node', [here + file, here + 'out'], { stdio: 'inherit', env: { ...process.env, BASE: 'http://localhost:8765/' } })
    const timer = setTimeout(() => t.kill(), 150000)
    t.on('exit', c => { clearTimeout(timer); resolve(c) })
  })
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${file}`)
  if (code !== 0) failed++
}
server.kill(); peer.kill()
process.exit(failed ? 1 : 0)
