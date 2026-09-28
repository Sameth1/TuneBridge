import { normalize, parseMusicUrl, confidentMatch } from './lib.js';

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
