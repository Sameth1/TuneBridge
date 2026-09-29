import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMusicUrl } from './resolve.js';
import { parseMusicUrl, isShortMusicLink, UserError } from './lib.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const cache = new Map();

async function cachedResolve(source, country = 'us') {
  const key = `${country}:${isShortMusicLink(source) ? source.trim() : parseMusicUrl(source).url}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = resolveMusicUrl(source, country);
  cache.set(key, { value, until: Date.now() + 60 * 60 * 1000 });
  try {
    const result = await value;
    if (!result.song.artist) cache.set(key, { value: Promise.resolve(result), until: Date.now() + 15_000 });
    return result;
  } catch (error) { cache.delete(key); throw error; }
}

function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const server = http.createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url, base);
    if (url.pathname === '/api/resolve') {
      if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
      const source = url.searchParams.get('url') || '';
      const requestedCountry = url.searchParams.get('country') || 'us';
      const country = /^[a-z]{2}$/i.test(requestedCountry) ? requestedCountry.toLowerCase() : 'us';
      if (source.length > 1500) return respond(res, 400, { code: 'url_too_long', error: 'The link is too long.' });
      try { return respond(res, 200, await cachedResolve(source, country)); }
      catch (error) { return respond(res, 400, errorBody(error)); }
    }
    if (url.pathname === '/api/check') {
      try {
        const source = url.searchParams.get('url') || '';
        if (!isShortMusicLink(source)) parseMusicUrl(source);
        return respond(res, 200, { valid: true });
      }
      catch (error) { return respond(res, 400, errorBody(error)); }
    }
    // /share is the installed app's share-sheet entry; the page reads the shared text and moves on to /s.
    const file = ['/', '/s', '/share'].includes(url.pathname) ? '/index.html' : url.pathname;
    const filename = path.resolve(root, `.${file}`);
    if (!filename.startsWith(root + path.sep)) return respond(res, 404, { error: 'Not found' });
    let content = await fs.readFile(filename);
    if (url.pathname === '/s' && url.searchParams.has('url')) {
      try {
        const data = await cachedResolve(url.searchParams.get('url'));
        const title = escapeHTML(`${data.song.title} — TuneBridge`);
        const description = escapeHTML(`${data.song.artist || 'Song'} · Open it in your own music app`);
        const image = data.song.artwork ? `<meta property="og:image" content="${escapeHTML(data.song.artwork)}">` : '';
        const publicBase = process.env.PUBLIC_BASE_URL || base;
        const canonical = escapeHTML(new URL(url.pathname + url.search, publicBase).href);
        const metadata = `<meta property="og:type" content="${data.kind === 'album' ? 'music.album' : 'music.song'}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}">${image}<meta name="twitter:card" content="summary_large_image">`;
        content = Buffer.from(content.toString().replace('</head>', `${metadata}</head>`));
      } catch { /* The page still displays a useful error in its UI. */ }
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return respond(res, 404, { error: 'Not found' });
    respond(res, 500, { code: 'server_error', error: 'Server error.' });
  }
});

// Catalog and network failures are not shown verbatim; the browser gets a generic, translatable code.
function errorBody(error) {
  return error instanceof UserError ? { code: error.code, error: error.message } : { code: 'resolve_failed', error: 'The song could not be resolved.' };
}

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

server.listen(port, () => console.log(`TuneBridge: http://localhost:${port}`));
