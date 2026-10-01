import { fetchJson, fetchText } from './http.js';
import { cleanTrackUrl } from './lib.js';

// iTunes Search allows roughly 20 requests a minute per IP and answers 403 beyond that:
// keep under the limit by waiting briefly, retry a 403 once, and reuse recent answers.
const cache = new Map();
const calls = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function itunes(url) {
  const now = Date.now();
  while (calls.length && calls[0] <= now - 60_000) calls.shift();
  if (calls.length >= 18) {
    const wait = calls[0] + 60_000 - now;
    if (wait > 8000) throw new Error('iTunes rate limit');
    await sleep(wait);
  }
  calls.push(Date.now());
  try { return await fetchJson(url); }
  catch (error) {
    if (!/HTTP 403/.test(error.message)) throw error;
    await sleep(2000);
    return fetchJson(url);
  }
}

async function cachedItunes(url) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.data;
  const data = await itunes(url);
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(url, { data, until: Date.now() + 60 * 60 * 1000 });
  return data;
}

export function appleSong(track) {
  return { title: track.trackName, artist: track.artistName, album: track.collectionName, duration: track.trackTimeMillis, isrc: null, artwork: track.artworkUrl100?.replace('100x100bb', '300x300bb') || null, url: cleanTrackUrl('apple', track.trackViewUrl), track };
}

export function appleAlbum(collection, country = 'us') {
  return {
    title: collection.collectionName,
    artist: collection.artistName,
    trackCount: collection.trackCount || null,
    year: collection.releaseDate?.slice(0, 4) || null,
    artwork: collection.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
    upc: null,
    url: `https://music.apple.com/${country}/album/${collection.collectionId}`
  };
}

export async function itunesSearch(term, country, entity = 'song', limit = 20) {
  const data = await cachedItunes(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&entity=${entity}&limit=${limit}`);
  const type = entity === 'album' ? 'collection' : 'track';
  return (data.results || []).filter(result => result.wrapperType === type);
}

export async function itunesLookup(ids, country, entity = 'song') {
  const data = await cachedItunes(`https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${encodeURIComponent(country)}&entity=${entity}`);
  return data.results || [];
}

const isoDuration = value => {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? ((Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 60 + Number(match[3] || 0)) * 1000 : null;
};

// Apple's public song page ("<title> by <artist> on Apple Music", ISO duration) confirms an id
// when the iTunes API is rate-limited.
export function parseApplePage(html, url) {
  const meta = name => html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`))?.[1]
    ?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const heading = meta('og:title')?.match(/^(.*) by (.*) on Apple Music$/);
  if (!heading) return null;
  return { title: heading[1], artist: heading[2], album: '', duration: isoDuration(meta('music:song:duration')), isrc: null, url: cleanTrackUrl('apple', url) };
}

export async function applePageSong(id, country) {
  const url = `https://music.apple.com/${country}/song/${id}`;
  return parseApplePage(await fetchText(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }), url);
}

// Apple Music's own search page carries its results as JSON. Unlike the iTunes Search API it is not limited
// to about 20 requests a minute, but it gives no song length, which each song's page then supplies.
export function parseAppleSearch(html) {
  const json = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/)?.[1];
  let data;
  try { data = json ? JSON.parse(json) : null; } catch { return []; }
  const songs = new Map();
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const descriptor = value.contentDescriptor;
    if (descriptor?.kind === 'song' && value.title && descriptor.url) {
      const id = descriptor.identifiers?.storeAdamID;
      const artist = (value.subtitleLinks || []).map(link => link.title).filter(Boolean).join(', ') ||
        String(value.subtitle || '').split('·').slice(1).join('·').trim();
      if (id && artist && !songs.has(id)) songs.set(id, { id, title: value.title, artist, url: cleanTrackUrl('apple', descriptor.url) });
    }
    Object.values(value).forEach(walk);
  };
  walk(data);
  return [...songs.values()].filter(song => song.url);
}

export async function appleWebSearch(term, country) {
  const html = await fetchText(`https://music.apple.com/${country}/search?term=${encodeURIComponent(term)}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  return parseAppleSearch(html);
}
