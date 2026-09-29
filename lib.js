// Icons are the brands' marks from Simple Icons (CC0), drawn on the brand colour.
export const PLATFORMS = [
  { id: 'apple', name: 'Apple Music', icon: '/icons/apple.svg', color: '#fa243c' },
  { id: 'spotify', name: 'Spotify', icon: '/icons/spotify.svg', color: '#000000' },
  { id: 'youtubeMusic', name: 'YouTube Music', icon: '/icons/youtubeMusic.svg', color: '#ff0000' },
  { id: 'youtube', name: 'YouTube', icon: '/icons/youtube.svg', color: '#ff0000' },
  { id: 'deezer', name: 'Deezer', icon: '/icons/deezer.svg', color: '#a238ff' },
  { id: 'soundcloud', name: 'SoundCloud', icon: '/icons/soundcloud.svg', color: '#ff5500' }
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

// User-facing errors carry a stable code so the browser can show them in the visitor's language.
export class UserError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Returns { platform, kind: 'track' | 'album', id, url } with a canonical URL for that platform.
export function parseMusicUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new UserError('invalid_url', 'Enter a valid music link.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UserError('bad_protocol', 'The link must start with http or https.');
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'music.apple.com' || host === 'geo.music.apple.com' || host === 'itunes.apple.com') {
    const country = /^[a-z]{2}$/i.test(parts[0] || '') ? parts[0].toLowerCase() : 'us';
    const song = url.searchParams.get('i') || (parts.includes('song') ? parts.at(-1) : null);
    if (/^\d+$/.test(song || '')) return { platform: 'apple', kind: 'track', id: song, url: `https://music.apple.com/${country}/song/${song}` };
    const album = parts.includes('album') ? parts.at(-1).replace(/^id/, '') : null;
    if (/^\d+$/.test(album || '')) return { platform: 'apple', kind: 'album', id: album, url: `https://music.apple.com/${country}/album/${album}` };
    throw new UserError('apple_track_required', 'An Apple Music song or album link is required.');
  }
  if (host === 'open.spotify.com' || host === 'spotify.com' || host === 'www.spotify.com') {
    for (const kind of ['track', 'album']) {
      const i = parts.indexOf(kind);
      const id = i >= 0 ? parts[i + 1] : null;
      if (/^[A-Za-z0-9]{22}$/.test(id || '')) return { platform: 'spotify', kind, id, url: `https://open.spotify.com/${kind}/${id}` };
    }
    throw new UserError('spotify_track_required', 'A Spotify track or album link is required.');
  }
  if (YOUTUBE_HOSTS.includes(host)) {
    const platform = host === 'music.youtube.com' ? 'youtubeMusic' : 'youtube';
    const id = host === 'youtu.be' ? parts[0]
      : parts[0] === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null;
    if (/^[\w-]{11}$/.test(id || '')) return { platform, kind: 'track', id, url: youtubeUrl(platform, id) };
    // Official album playlists are auto-generated with an OLAK5uy_ id and play on both YouTube sites.
    const list = url.searchParams.get('list');
    if (parts[0] === 'playlist' && /^OLAK5uy_[\w-]+$/.test(list || '')) return { platform, kind: 'album', id: list, url: youtubeAlbumUrl(platform, list) };
    throw new UserError('youtube_track_required', 'A YouTube or YouTube Music song or album link is required.');
  }
  if (host === 'www.deezer.com' || host === 'deezer.com') {
    for (const kind of ['track', 'album']) {
      const i = parts.indexOf(kind);
      const id = i >= 0 ? parts[i + 1] : null;
      if (/^\d+$/.test(id || '')) return { platform: 'deezer', kind, id, url: `https://www.deezer.com/${kind}/${id}` };
    }
    throw new UserError('deezer_track_required', 'A Deezer track or album link is required.');
  }
  if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') {
    if (parts.length >= 3 && parts[1] === 'sets' && !SOUNDCLOUD_RESERVED.includes(parts[0])) {
      const path = parts.slice(0, 3).join('/');
      return { platform: 'soundcloud', kind: 'album', id: path, url: `https://soundcloud.com/${path}` };
    }
    if (parts.length < 2 || SOUNDCLOUD_RESERVED.includes(parts[0]) || SOUNDCLOUD_USER_PAGES.includes(parts[1])) throw new UserError('soundcloud_track_required', 'A SoundCloud track or album link is required.');
    return { platform: 'soundcloud', kind: 'track', id: parts.join('/'), url: `https://soundcloud.com/${parts.join('/')}` };
  }
  throw new UserError('unsupported_platform', 'Apple Music, Spotify, YouTube Music, YouTube, Deezer and SoundCloud links are supported.');
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
    mono: ['mono'],
    stereo: ['stereo'],
    edit: ['edit'],
    extended: ['extended'],
    rework: ['remake', 'rework', 'bootleg', 'flip', 'mashup', 'nightcore', '8d']
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

// Album titles: Apple appends " - Single" / " - EP"; editions (Deluxe, Remastered, Live…) are different releases.
const ALBUM_SUFFIX = /\s[-–—]\s(single|ep)$/i;
const EDITIONS = {
  deluxe: ['deluxe', 'expanded', 'special', 'collector', 'platinum', 'bonus', 'anniversary'],
  remaster: ['remaster', 'remastered'],
  live: ['live', 'canlı'],
  acoustic: ['acoustic', 'akustik'],
  instrumental: ['instrumental'],
  remix: ['remixes', 'remixed'],
  speed: ['sped up', 'slowed']
};

function editionTags(value) {
  const title = String(value || '').toLocaleLowerCase('und');
  return Object.entries(EDITIONS).filter(([, words]) => words.some(word =>
    new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u').test(title))).map(([tag]) => tag).join('|');
}

export function sameAlbumTitle(first, second) {
  const a = String(first || '').replace(ALBUM_SUFFIX, '');
  const b = String(second || '').replace(ALBUM_SUFFIX, '');
  return Boolean(normalize(a)) && normalize(a) === normalize(b) && editionTags(a) === editionTags(b);
}

// Same title, edition and artist; a shared UPC settles it, otherwise the track counts must agree
// (one track of slack only for the same release year, where a platform may hide a hidden or bonus track).
export function albumMatch(source, candidate) {
  if (source.upc && candidate.upc) return String(source.upc).replace(/^0+/, '') === String(candidate.upc).replace(/^0+/, '');
  if (!sameAlbumTitle(source.title, candidate.title) || !artistsOverlap(source.artist, candidate.artist)) return false;
  if (!source.trackCount || !candidate.trackCount) return true;
  const gap = Math.abs(source.trackCount - candidate.trackCount);
  return gap === 0 || (gap === 1 && Boolean(source.year) && source.year === candidate.year);
}

// "Barış Manço" → "barismanco": compares names across diacritics and spacing ("barismancotv", "sezen-aksu-official").
export function compactName(value) {
  return normalize(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/\s/g, '');
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
  if (platform === 'youtube' || platform === 'youtubeMusic') {
    const id = url.searchParams.get('v');
    return /^[\w-]{11}$/.test(id || '') ? youtubeUrl(platform, id) : null;
  }
  url.search = '';
  return url.href;
}

export function youtubeAlbumUrl(platform, list) {
  return platform === 'youtubeMusic' ? `https://music.youtube.com/playlist?list=${list}` : `https://www.youtube.com/playlist?list=${list}`;
}

// A video id plays on both sites, so one id can serve YouTube and YouTube Music.
export function youtubeUrl(platform, id) {
  return platform === 'youtubeMusic' ? `https://music.youtube.com/watch?v=${id}` : `https://www.youtube.com/watch?v=${id}`;
}

export function searchLinks(title, artist) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return {
    apple: `https://music.apple.com/search?term=${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    youtubeMusic: `https://music.youtube.com/search?q=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    deezer: `https://www.deezer.com/search/${q}`,
    soundcloud: `https://soundcloud.com/search/sounds?q=${q}`
  };
}

// ---- Closest-match support: raw titles hidden in long names, and a similarity score. ----

// Words that describe a video or an upload rather than the song ("Official Music Video - HD Version").
const LABEL_WORDS = new Set(['official', 'music', 'video', 'audio', 'lyric', 'lyrics', 'hd', 'hq', '4k', '8k', 'version',
  'clip', 'klip', 'videoklip', 'videoclip', 'visualizer', 'visualiser', 'mv', 'm', 'v', 'full', 'resmi', 'oficial',
  'officiel', 'premiere', 'exclusive', 'new', 'teaser', 'with', 'subtitles', 'sözleri', 'şarkı', 'sozleri']);

export function isLabelOnly(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  return !words.length || words.every(word => LABEL_WORDS.has(word) || /^(19|20)\d\d$/.test(word));
}

function stripLabels(text) {
  let cleaned = String(text || '').replace(/\s*[([{【]([^)\]}】]*)[)\]}】]/g, (match, inner) => (isLabelOnly(inner) ? '' : match));
  const parts = cleaned.split(/\s+[-–—]\s+/);
  while (parts.length > 1 && isLabelOnly(parts.at(-1))) parts.pop();
  const words = parts.join(' - ').split(/\s+/);
  while (words.length > 1 && isLabelOnly(words.at(-1))) words.pop();
  return words.join(' ').trim();
}

const primaryArtist = artist => String(artist || '').split(/,|&| feat\.? | ft\.? | x /i)[0].trim();
const sameArtistName = (a, b) => artistsOverlap(a, b) ||
  (compactName(primaryArtist(a)).length >= 3 && compactName(b).includes(compactName(primaryArtist(a))));

// Every plausible song name inside a title such as
// "Nour El Ein | Official Music Video - HD Version | عمرو دياب - نور العين" → ["Nour El Ein", "نور العين", …].
export function titleVariants(title, artist = '') {
  const variants = [];
  const push = value => {
    const cleaned = stripLabels(value);
    if (cleaned && !isLabelOnly(cleaned) && !variants.some(v => normalize(v) === normalize(cleaned))) variants.push(cleaned);
  };
  for (const segment of String(title || '').split(/\s+\|{1,2}\s+|\s+\/\/\s+/)) {
    const cleaned = stripLabels(segment);
    if (isLabelOnly(cleaned)) continue;
    const split = splitArtistTitle(cleaned);
    if (!split) push(cleaned);
    else if (sameArtistName(artist, split.artist)) push(split.title);
    else if (sameArtistName(artist, split.title)) push(split.artist);
    else { push(split.title); push(cleaned); }
  }
  // Plain forms: without bracketed notes or a featured artist.
  for (const variant of [...variants]) {
    push(variant.replace(/\s*[([{【].*?[)\]}】]/g, ''));
    push(variant.replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, ''));
  }
  return variants.length ? variants : [String(title || '')];
}

function ratio(a, b) {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

// 1 for the same name; tolerant of spelling ("Nour El Ein" / "Nour El Ain") and of extra words.
export function titleSimilarity(first, second) {
  const a = normalize(first);
  const b = normalize(second);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aw = a.split(' ');
  const bw = b.split(' ');
  const common = aw.filter(word => bw.includes(word)).length;
  const dice = (2 * common) / (aw.length + bw.length);
  const contained = aw.every(word => bw.includes(word)) || bw.every(word => aw.includes(word)) ? 0.85 : 0;
  return Math.max(dice, contained, ratio(compactName(first), compactName(second)));
}

function artistSimilarity(first, second) {
  if (!first || !second) return 0.5;
  if (sameArtistName(first, second) || sameArtistName(second, first)) return 1;
  return ratio(compactName(primaryArtist(first)), compactName(primaryArtist(second)));
}

// How alike two recordings look, 0–1. A different version (live, remix…) never scores.
export function matchScore(source, candidate) {
  if (!candidate?.title) return { score: 0, title: 0, artist: 0 };
  if (source.isrc && candidate.isrc && source.isrc === candidate.isrc) return { score: 1, title: 1, artist: 1 };
  const variants = source.titleVariants?.length ? source.titleVariants : [source.title];
  const title = Math.max(0, ...variants.map(variant =>
    (versionTags(variant) === versionTags(candidate.title) ? titleSimilarity(variant, candidate.title) : 0)));
  const artist = artistSimilarity(source.artist, candidate.artist);
  const parts = [[title, 0.5], [artist, 0.3]];
  if (source.duration && candidate.duration) {
    const gap = Math.abs(source.duration - candidate.duration) / 1000;
    // A music video's length includes intros and outros: close lengths still help, far ones say nothing.
    if (source.durationReliable !== false) parts.push([Math.max(0, 1 - gap / 30), 0.2]);
    else if (gap <= 120) parts.push([1 - gap / 240, 0.2]);
  }
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  return { score: parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight, title, artist };
}

// The best-scoring candidate that is clearly the same song under another name, or null.
export function selectClosest(source, candidates, minimum = 0.78) {
  return candidates
    .filter(candidate => candidate?.url)
    .map(candidate => ({ candidate, ...matchScore(source, candidate) }))
    .filter(entry => entry.score >= minimum && entry.title >= 0.72 && entry.artist >= 0.6)
    .sort((a, b) => b.score - a.score)[0] || null;
}
