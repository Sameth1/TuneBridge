import { normalize, parseMusicUrl, confidentMatch, youtubeAlbumUrl, compactName } from './lib.js';

let queue = Promise.resolve();
let lastRequest = 0;

async function getMusicBrainz(url) {
  const task = queue.then(async () => {
    const wait = Math.max(0, lastRequest + 1100 - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const contact = process.env.MUSICBRAINZ_CONTACT || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      for (let attempt = 0; attempt < 2; attempt++) {
        const retryWait = Math.max(0, lastRequest + 1100 - Date.now());
        if (retryWait) await new Promise(resolve => setTimeout(resolve, retryWait));
        lastRequest = Date.now();
        const response = await fetch(url, { headers: { 'User-Agent': `TuneBridge/0.1 (${contact})`, Accept: 'application/json' }, signal: controller.signal });
        if (response.status === 404) return null;
        if ((response.status === 503 || response.status === 429) && attempt === 0) continue;
        if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
        return response.json();
      }
    } finally { clearTimeout(timeout); }
  });
  queue = task.catch(() => {});
  return task;
}

export function pickRecordingId(lookup, title) {
  const recordings = (lookup?.relations || [])
    .filter(relation => relation['target-type'] === 'recording' && relation.recording?.id)
    .map(relation => relation.recording);
  if (recordings.length === 1) return recordings[0].id;
  const matching = recordings.filter(recording => normalize(recording.title) === normalize(title));
  return matching.length === 1 ? matching[0].id : null;
}

export function extractPlatformLinks(recording, country = 'us') {
  const links = {};
  const choices = {};
  const relations = recording?.relations || [];
  for (const relation of relations) {
    try {
      const parsed = parseMusicUrl(relation.url?.resource);
      if (parsed.kind !== 'track') continue;
      if (!choices[parsed.platform]) choices[parsed.platform] = [];
      choices[parsed.platform].push(parsed.url);
    } catch { /* Skip album, artist and unsupported links. */ }
  }
  for (const [platform, urls] of Object.entries(choices)) {
    if (platform === 'apple') {
      const preferred = urls.find(url => new URL(url).pathname.split('/')[1]?.toLowerCase() === country.toLowerCase());
      links.apple = preferred || urls.find(url => new URL(url).pathname.split('/')[1]?.toLowerCase() === 'us') || urls[0];
    } else links[platform] = urls[0];
  }
  return links;
}

export function extractLinks(recording, spotifyUrl, country = 'us') {
  const sourceId = parseMusicUrl(spotifyUrl).id;
  const hasSource = (recording?.relations || []).some(relation => {
    try { const parsed = parseMusicUrl(relation.url?.resource); return parsed.platform === 'spotify' && parsed.id === sourceId; }
    catch { return false; }
  });
  if (!hasSource) return {};
  const links = extractPlatformLinks(recording, country);
  delete links.spotify;
  return links;
}

export async function lookupSpotifyRecording(input, title, country = 'us') {
  if (input.platform !== 'spotify') return null;
  const lookup = await getMusicBrainz(`https://musicbrainz.org/ws/2/url?resource=${encodeURIComponent(input.url)}&inc=recording-rels&fmt=json`);
  const recordingId = pickRecordingId(lookup, title);
  if (!recordingId) return null;
  const recording = await getMusicBrainz(`https://musicbrainz.org/ws/2/recording/${recordingId}?inc=artist-credits+isrcs+url-rels&fmt=json`);
  if (!recording) return null;
  return {
    title: recording.title,
    artist: (recording['artist-credit'] || []).filter(item => item.artist).map(item => item.name || item.artist.name).join(', '),
    duration: recording.length || null,
    isrcs: recording.isrcs || [],
    links: extractLinks(recording, input.url, country)
  };
}

export async function lookupIsrcRecording(isrc, source, country = 'us') {
  if (!/^[A-Z0-9]{12}$/.test(isrc || '')) return null;
  const result = await getMusicBrainz(`https://musicbrainz.org/ws/2/isrc/${isrc}?inc=artist-credits+url-rels&fmt=json`);
  const eligible = (result?.recordings || []).filter(recording => {
    const artist = (recording['artist-credit'] || []).filter(item => item.artist).map(item => item.name || item.artist.name).join(', ');
    return confidentMatch(source, { title: recording.title, artist, duration: recording.length, isrc });
  });
  if (!eligible.length) return null;
  eligible.sort((a, b) => Object.keys(extractPlatformLinks(b, country)).length - Object.keys(extractPlatformLinks(a, country)).length);
  const selected = eligible[0];
  return { title: selected.title, duration: selected.length, links: extractPlatformLinks(selected, country) };
}

// Album links on a MusicBrainz release. Apple links are rewritten to the visitor's storefront,
// and an OLAK5uy_ album playlist serves both YouTube sites.
export function extractAlbumLinks(release, country = 'us') {
  const links = {};
  for (const relation of release?.relations || []) {
    let parsed;
    try { parsed = parseMusicUrl(relation.url?.resource); } catch { continue; }
    if (parsed.kind !== 'album') continue;
    if (parsed.platform === 'apple') links.apple ||= `https://music.apple.com/${country}/album/${parsed.id}`;
    else if (parsed.platform === 'youtube' || parsed.platform === 'youtubeMusic') {
      links.youtubeMusic ||= youtubeAlbumUrl('youtubeMusic', parsed.id);
      links.youtube ||= youtubeAlbumUrl('youtube', parsed.id);
    } else links[parsed.platform] ||= parsed.url;
  }
  return links;
}

const digits = value => String(value || '').replace(/^0+/, '');

export async function lookupReleaseByBarcode(upc, country = 'us') {
  if (!/^\d{8,14}$/.test(upc || '')) return {};
  const search = await getMusicBrainz(`https://musicbrainz.org/ws/2/release?query=barcode:${upc}&fmt=json`);
  const ids = (search?.releases || []).filter(release => digits(release.barcode) === digits(upc)).slice(0, 2).map(release => release.id);
  const links = {};
  for (const id of ids) {
    const release = await getMusicBrainz(`https://musicbrainz.org/ws/2/release/${id}?inc=url-rels&fmt=json`);
    for (const [platform, url] of Object.entries(extractAlbumLinks(release, country))) links[platform] ||= url;
  }
  return links;
}

// Spotify ids that MusicBrainz links to an artist or a release. Without Spotify API credentials they lead to the
// artist's top tracks and the album's track list, both readable from Spotify's public embed pages.
const spotifyIds = new Map();
const quoted = value => `"${String(value || '').replace(/["\\]/g, ' ').trim()}"`;

async function cachedIds(key, find) {
  const hit = spotifyIds.get(key);
  if (hit && hit.until > Date.now()) return hit.ids;
  const ids = [...new Set(await find())].slice(0, 3);
  if (spotifyIds.size >= 500) spotifyIds.delete(spotifyIds.keys().next().value);
  spotifyIds.set(key, { ids, until: Date.now() + 12 * 3600_000 });
  return ids;
}

async function spotifyLinksOf(entity, mbids, kind) {
  const pattern = new RegExp(`open\\.spotify\\.com/${kind}/([A-Za-z0-9]{22})`);
  const ids = [];
  for (const mbid of mbids) {
    const full = await getMusicBrainz(`https://musicbrainz.org/ws/2/${entity}/${mbid}?inc=url-rels&fmt=json`);
    for (const relation of full?.relations || []) {
      const id = relation.url?.resource?.match(pattern)?.[1];
      if (id) ids.push(id);
    }
  }
  return ids;
}

export async function spotifyArtistIds(name) {
  const key = compactName(name);
  if (!key) return [];
  return cachedIds(`artist:${key}`, async () => {
    const search = await getMusicBrainz(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:${quoted(name)} OR alias:${quoted(name)}`)}&limit=5&fmt=json`);
    const named = (search?.artists || [])
      .filter(artist => [artist.name, artist['sort-name'], ...(artist.aliases || []).map(alias => alias.name)].some(value => compactName(value) === key))
      .slice(0, 2).map(artist => artist.id);
    return spotifyLinksOf('artist', named, 'artist');
  });
}

export async function spotifyAlbumIds(album, artist) {
  const title = normalize(album);
  if (!title || !artist) return [];
  return cachedIds(`album:${title}:${compactName(artist)}`, async () => {
    const search = await getMusicBrainz(`https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(`release:${quoted(album)} AND artist:${quoted(artist)}`)}&limit=5&fmt=json`);
    const named = (search?.releases || []).filter(release => normalize(release.title) === title).slice(0, 2).map(release => release.id);
    return spotifyLinksOf('release', named, 'album');
  });
}
