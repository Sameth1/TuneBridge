export const PLATFORMS = [
  { id: 'apple', name: 'Apple Music', mark: '♫', color: '#fb5b6b' },
  { id: 'spotify', name: 'Spotify', mark: '◉', color: '#1ed760' },
  { id: 'youtube', name: 'YouTube Music', mark: '▶', color: '#ff4040' },
  { id: 'deezer', name: 'Deezer', mark: '▥', color: '#a970ff' },
  { id: 'soundcloud', name: 'SoundCloud', mark: '☁', color: '#ff8b3d' }
];

export function parseMusicUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Geçerli bir müzik bağlantısı gir.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Bağlantı http veya https olmalı.');
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'music.apple.com') {
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
  if (host === 'music.youtube.com') {
    const id = url.searchParams.get('v');
    if (parts[0] !== 'watch' || !/^[\w-]{11}$/.test(id || '')) throw new Error('YouTube Music şarkı bağlantısı gerekli.');
    return { platform: 'youtube', id, url: `https://music.youtube.com/watch?v=${id}` };
  }
  if (host === 'www.deezer.com' || host === 'deezer.com') {
    const i = parts.indexOf('track');
    const id = i >= 0 ? parts[i + 1] : null;
    if (!/^\d+$/.test(id || '')) throw new Error('Deezer şarkı bağlantısı gerekli.');
    return { platform: 'deezer', id, url: `https://www.deezer.com/track/${id}` };
  }
  if (host === 'soundcloud.com' || host === 'www.soundcloud.com') {
    if (parts.length < 2 || ['sets', 'likes'].includes(parts[1])) throw new Error('SoundCloud parça bağlantısı gerekli.');
    return { platform: 'soundcloud', id: parts.join('/'), url: `https://soundcloud.com/${parts.join('/')}` };
  }
  throw new Error('Şimdilik Apple Music, Spotify, YouTube Music, Deezer ve SoundCloud bağlantıları destekleniyor.');
}

export function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('und')
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
  const artistMatches = artist === candidateArtist ||
    artist.split(' ').some(token => token.length > 3 && candidateArtist.split(' ').includes(token)) ||
    (title === candidateTitle && durationDelta !== null && durationDelta <= 3000 &&
      /^[a-z ]+$/.test(artist + candidateArtist) && Math.min(artist.length, candidateArtist.length) >= 5 && editDistance(artist, candidateArtist) <= 2);
  const sameIsrc = source.isrc && candidate.isrc && source.isrc === candidate.isrc;
  if (source.isrc && candidate.isrc && !sameIsrc) return false;
  const durationMatches = durationDelta !== null && durationDelta <= 6000;
  return artistMatches && (sameIsrc || durationMatches);
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
