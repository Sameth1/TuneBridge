import { fetchJson } from './http.js';
import { sameTrackTitle, artistsOverlap, cleanChannelName, splitArtistTitle, cleanTrackUrl } from './lib.js';

const PLATFORM_KEYS = { apple: ['appleMusic', 'itunes'], spotify: ['spotify'], youtubeMusic: ['youtubeMusic'], youtube: ['youtube'], deezer: ['deezer'], soundcloud: ['soundcloud'] };

// YouTube entities carry the channel as artist and sometimes "Artist - Title" as title.
export function entityAgrees(song, entity) {
  if (!entity?.title || entity.type && entity.type !== 'song') return false;
  const split = splitArtistTitle(entity.title);
  const titleOk = sameTrackTitle(song.title, entity.title) || Boolean(split && sameTrackTitle(song.title, split.title));
  const artistOk = artistsOverlap(song.artist, cleanChannelName(entity.artistName)) || Boolean(split && artistsOverlap(song.artist, split.artist));
  return titleOk && artistOk;
}

export function odesliLinks(data, song) {
  const entities = data?.entitiesByUniqueId || {};
  const source = entities[data?.entityUniqueId];
  const reference = { ...song };
  if (!reference.artist && source) {
    const split = cleanChannelName(source.artistName) ? null : splitArtistTitle(source.title);
    reference.artist = cleanChannelName(source.artistName) || split?.artist || '';
  }
  const links = {};
  for (const [platform, keys] of Object.entries(PLATFORM_KEYS)) {
    for (const key of keys) {
      const link = data?.linksByPlatform?.[key];
      if (!link?.url || !entityAgrees(reference, entities[link.entityUniqueId])) continue;
      const url = cleanTrackUrl(platform, link.url);
      if (url) { links[platform] = url; break; }
    }
  }
  return { links, artist: reference.artist };
}

// Odesli retired its keyless public API (401 PUBLIC_API_ACCESS_DEPRECATED), so it is only used with a key.
export async function fetchOdesli(sourceUrl, country = 'us') {
  const key = process.env.ODESLI_API_KEY;
  if (!key) return null;
  return fetchJson(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(sourceUrl)}&userCountry=${country.toUpperCase()}&songIfSingle=true&key=${encodeURIComponent(key)}`, { timeout: 9000 });
}
