// A tiny static server for dist/, for testing on this computer and phones on the same Wi-Fi:
// node scripts/serve.js [port]. The game is served at /act-natural/, as on play.nithun.no, and
// / redirects there. No proxy for /act-natural/peer/ or /act-natural/mqtt: add
// ?signal=host:port or ?broker=ws://host:port to use local servers, as the tests do.
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, normalize } from 'path'

const port = Number(process.argv[2] || process.env.PORT || 8765)
const dist = new URL('../dist/', import.meta.url).pathname
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }

const PREFIX = '/act-natural/'

createServer(async (req, res) => {
  const [rawPath, query] = req.url.split('?')
  if (rawPath === '/' || rawPath === '/act-natural') {
    res.writeHead(rawPath === '/' ? 302 : 301, { Location: PREFIX + (query ? '?' + query : '') }); return res.end()
  }
  if (!rawPath.startsWith(PREFIX)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found') }
  let path = normalize(decodeURIComponent(rawPath.slice(PREFIX.length - 1))).replace(/^(\.\.[/\\])+/, '')
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(dist + path.replace(/^\//, ''))
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found')
  }
}).listen(port, () => console.log(`Act Natural on http://localhost:${port}/act-natural/  (TV: ?host · demo: ?host&demo=6)`))
