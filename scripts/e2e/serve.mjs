import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

/** E2E 静态服务器：正确 MIME（模块脚本必需）；默认服务 dist-mock。用法：node scripts/e2e/serve.mjs [port] [root] */
import { isAbsolute } from 'node:path';
const ROOT = process.argv[3]
  ? isAbsolute(process.argv[3])
    ? process.argv[3]
    : join(process.cwd(), process.argv[3])
  : new URL('../../dist-mock', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 4323);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.sesx': 'application/octet-stream',
  '.svp': 'application/octet-stream',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!extname(p)) p += '/index.html';
    const file = join(ROOT, normalize(p).replace(/^([/\\.])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
