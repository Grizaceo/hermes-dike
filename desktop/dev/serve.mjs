// Servidor estático mínimo para dev/dist (solo stdlib, solo 127.0.0.1).
// Uso: npm run dev:serve  →  http://127.0.0.1:4173/

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT || 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/index.html'
    const file = path.normalize(path.join(DIST, rel))
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404); res.end('no encontrado — corre `npm run dev:build` primero')
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('Diké dev en http://127.0.0.1:' + PORT + '/  (Ctrl+C para salir)')
})
