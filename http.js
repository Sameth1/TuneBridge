import { UserError } from './lib.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; TuneBridge/0.2; music link resolver)';

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 7000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return options.as === 'text' ? await response.text() : await response.json();
  } finally { clearTimeout(timer); }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transient = error => /HTTP (403|429|5\d\d)$/.test(error.message) || error instanceof SyntaxError;

// `retry: true` repeats a request up to twice after a rate limit, a server error, a bot-check 403
// or an HTML page where JSON was expected; catalogs such as Deezer do this intermittently.
async function withRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    try { return await request(url, options); }
    catch (error) {
      if (!options.retry || !transient(error) || attempt >= 2) throw error;
      await sleep(700 * (attempt + 1));
    }
  }
}

export const fetchJson = (url, options = {}) => withRetry(url, options);
export const fetchText = (url, options = {}) => withRetry(url, { ...options, as: 'text' });

// Follows short-link redirects by hand so every hop can be checked before it is requested.
export async function followRedirects(url, accept, hops = 4) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    if (accept(current)) return current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, current);
      // Only public HTTPS hosts: a redirect must not reach localhost or an IP address on the server's network.
      if (next.protocol !== 'https:' || !next.hostname.includes('.') || /^[\d.]+$|^\[|localhost$/i.test(next.hostname)) break;
      current = next.href;
    } finally { clearTimeout(timer); }
  }
  if (accept(current)) return current;
  throw new UserError('short_link_failed', 'This short link does not lead to a song.');
}

// Extracts a JSON object literal that starts right after `marker` in an HTML page.
export function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const open = html.indexOf('{', start + marker.length);
  const openArray = html.indexOf('[', start + marker.length);
  const first = [open, openArray].filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return null;
  let depth = 0;
  let inString = false;
  for (let i = first; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(first, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function findDeep(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findDeep(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

export function findAllDeep(value, key, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) { value.forEach(item => findAllDeep(item, key, found)); return found; }
  for (const [name, child] of Object.entries(value)) {
    if (name === key) found.push(child);
    else findAllDeep(child, key, found);
  }
  return found;
}
