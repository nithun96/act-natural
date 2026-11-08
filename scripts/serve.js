// A tiny static server for dist/, for testing on this computer and phones on the same Wi-Fi:
// node scripts/serve.js [port]. No proxy for /peer/ or /mqtt: add ?signal=host:port or
// ?broker=ws://host:port to use local servers, as the tests do.
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, normalize } from 'path'

const port = Number(process.argv[2] || process.env.PORT || 8765)
const dist = new URL('../dist/', import.meta.url).pathname
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(dist + path.replace(/^\//, ''))
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found')
  }
}).listen(port, () => console.log(`Act Natural on http://localhost:${port}/  (TV: /?host · demo: /?host&demo=6)`))
