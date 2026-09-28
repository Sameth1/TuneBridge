export const PLATFORMS = [
  { id: 'apple', name: 'Apple Music', mark: '♫', color: '#fb5b6b' },
  { id: 'spotify', name: 'Spotify', mark: '◉', color: '#1ed760' },
  { id: 'youtube', name: 'YouTube Music', mark: '▶', color: '#ff4040' },
  { id: 'deezer', name: 'Deezer', mark: '▥', color: '#a970ff' },
  { id: 'soundcloud', name: 'SoundCloud', mark: '☁', color: '#ff8b3d' }
];

const YOUTUBE_HOSTS = ['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'];
const SOUNDCLOUD_RESERVED = ['discover', 'search', 'you', 'stream', 'charts', 'upload', 'settings', 'messages', 'notifications', 'pages'];
const SOUNDCLOUD_USER_PAGES = ['sets', 'likes', 'tracks', 'albums', 'reposts', 'popular-tracks', 'followers', 'following', 'comments', 'spotlight'];
const SHORT_LINK_HOSTS = ['on.soundcloud.com', 'spotify.link', 'link.deezer.com', 'deezer.page.link'];

// App share sheets often produce short links that redirect to the real track URL.
export function isShortMusicLink(input) {
  try {
    const url = new URL(String(input).trim());
    return url.protocol === 'https:' && SHORT_LINK_HOSTS.includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function parseMusicUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Geçerli bir müzik bağlantısı gir.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Bağlantı http veya https olmalı.');
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'music.apple.com' || host === 'geo.music.apple.com') {
    const id = url.searchParams.get('i') || (parts.includes('song') ? parts.at(-1) : null);
    if (!/^\d+$/.test(id || '')) throw new Error('Apple Music şarkı bağlantısı gerekli; albüm bağlantısı desteklenmiyor.');
    return { platform: 'apple', id, url: url.href };
  }
  if (host === 'open.spotify.com' || host === 'spotify.com' || host === 'www.spotify.com') {
    const i = parts.indexOf('track');
    const id = i >= 0 ? parts[i + 1] : null;
    if (!/^[A-Za-z0-9]{22}$/.test(id || '')) throw new Error('Spotify şarkı bağlantısı gerekli.');
    return { platform: 'spotify', id, url: `https://open.spotify.com/track/${id}` };
  }
  if (YOUTUBE_HOSTS.includes(host)) {
    const id = host === 'youtu.be' ? parts[0]
      : parts[0] === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null;
    if (!/^[\w-]{11}$/.test(id || '')) throw new Error('YouTube Music şarkı bağlantısı gerekli.');
    return { platform: 'youtube', id, url: `https://music.youtube.com/watch?v=${id}` };
  }
  if (host === 'www.deezer.com' || host === 'deezer.com') {
    const i = parts.indexOf('track');
    const id = i >= 0 ? parts[i + 1] : null;
    if (!/^\d+$/.test(id || '')) throw new Error('Deezer şarkı bağlantısı gerekli.');
    return { platform: 'deezer', id, url: `https://www.deezer.com/track/${id}` };
  }
  if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') {
    if (parts.length < 2 || SOUNDCLOUD_RESERVED.includes(parts[0]) || SOUNDCLOUD_USER_PAGES.includes(parts[1])) throw new Error('SoundCloud parça bağlantısı gerekli.');
    return { platform: 'soundcloud', id: parts.join('/'), url: `https://soundcloud.com/${parts.join('/')}` };
  }
  throw new Error('Şimdilik Apple Music, Spotify, YouTube Music, Deezer ve SoundCloud bağlantıları destekleniyor.');
}

const SUFFIX_WORDS = 'remaster|remastered|live|edit|version|versiyon|mix|remix|feat|ft|with|acoustic|akustik|mono|stereo|from|bonus|demo|instrumental|single|radio|canlı|sped up|slowed';
const SUFFIX = new RegExp(`\\s[-–—]\\s(?=.*(?<![\\p{L}\\p{N}])(${SUFFIX_WORDS})(?![\\p{L}\\p{N}])).*$`, 'iu');

// Spotify writes "Song - Remastered 2011" where Apple writes "Song (Remastered 2011)"; versionTags still compares the version.
export function normalize(value) {
  return String(value || '').normalize('NFKC').replace(SUFFIX, ' ').toLocaleLowerCase('und')
    .replace(/\s*[([{（][^\])}）]*[\])}）]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function versionTags(value) {
  const title = String(value || '').toLocaleLowerCase('und');
  const groups = {
    live: ['live', 'canlı', 'en vivo', 'ao vivo'],
    remix: ['remix', 'remiks'],
    acoustic: ['acoustic', 'akustik'],
    instrumental: ['instrumental', 'enstrümantal'],
    karaoke: ['karaoke'],
    demo: ['demo'],
    radio: ['radio edit'],
    speedup: ['sped up'],
    slowed: ['slowed'],
    cover: ['cover'],
    remaster: ['remaster', 'remastered'],
    mono: ['mono'],
    stereo: ['stereo']
  };
  return Object.entries(groups).filter(([, words]) => words.some(word =>
    new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u').test(title)
  )).map(([tag]) => tag).join('|');
}

export function sameTrackTitle(first, second) {
  return Boolean(normalize(first)) && normalize(first) === normalize(second) && versionTags(first) === versionTags(second);
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}

export function confidentMatch(source, candidate) {
  const title = normalize(source.title);
  const candidateTitle = normalize(candidate.title);
  const artist = normalize(source.artist);
  const candidateArtist = normalize(candidate.artist);
  if (!title || !artist || !candidateTitle || !candidateArtist) return false;
  if (!sameTrackTitle(source.title, candidate.title)) return false;
  const durationDelta = source.duration && candidate.duration ? Math.abs(source.duration - candidate.duration) : null;
  const artistMatches = artistsOverlap(source.artist, candidate.artist) ||
    (title === candidateTitle && durationDelta !== null && durationDelta <= 3000 &&
      /^[a-z ]+$/.test(artist + candidateArtist) && Math.min(artist.length, candidateArtist.length) >= 5 && editDistance(artist, candidateArtist) <= 2);
  const sameIsrc = source.isrc && candidate.isrc && source.isrc === candidate.isrc;
  if (source.isrc && candidate.isrc && !sameIsrc) return false;
  const durationMatches = durationDelta !== null && durationDelta <= 6000;
  return artistMatches && (sameIsrc || durationMatches);
}

export function artistsOverlap(first, second) {
  const a = normalize(first);
  const b = normalize(second);
  if (!a || !b) return false;
  const tokens = b.split(' ');
  return a === b || a.split(' ').some(token => token.length > 3 && tokens.includes(token));
}

// For sources whose duration cannot be trusted (e.g. a music video with an intro):
// accept an identical title and artist only when every such catalog result is the same recording.
export function selectUniqueTitleArtist(source, candidates) {
  const matches = candidates.filter(candidate => sameTrackTitle(source.title, candidate.title) &&
    artistsOverlap(source.artist, candidate.artist) &&
    !(source.isrc && candidate.isrc && source.isrc !== candidate.isrc));
  if (!matches.length) return null;
  const durations = matches.map(candidate => candidate.duration).filter(Boolean);
  if (durations.length && Math.max(...durations) - Math.min(...durations) > 6000) return null;
  return matches[0];
}

export function cleanChannelName(name) {
  return String(name || '').replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, '').replace(/\s+(Official)(\s+(Channel|Music))?$/i, '').trim();
}

export function splitArtistTitle(value) {
  const match = String(value || '').match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : null;
}

export function cleanTrackUrl(platform, rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (platform === 'apple') {
    // Drop affiliate, tracking and app-launch parameters; keep the song id.
    const song = url.searchParams.get('i');
    url.search = song ? `?i=${song}` : '';
    if (url.hostname === 'geo.music.apple.com' || url.hostname === 'music.apple.com') return url.href;
    return null;
  }
  if (platform === 'youtube') {
    const id = url.searchParams.get('v');
    return /^[\w-]{11}$/.test(id || '') ? `https://music.youtube.com/watch?v=${id}` : null;
  }
  url.search = '';
  return url.href;
}

export function searchLinks(title, artist) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return {
    apple: `https://music.apple.com/search?term=${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    youtube: `https://music.youtube.com/search?q=${q}`,
    deezer: `https://www.deezer.com/search/${q}`,
    soundcloud: `https://soundcloud.com/search/sounds?q=${q}`
  };
}
