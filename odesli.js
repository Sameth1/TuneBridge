import { fetchJson } from './http.js';
import { sameTrackTitle, artistsOverlap, cleanChannelName, splitArtistTitle, cleanTrackUrl } from './lib.js';

const PLATFORM_KEYS = { apple: ['appleMusic', 'itunes'], spotify: ['spotify'], youtube: ['youtubeMusic', 'youtube'], deezer: ['deezer'], soundcloud: ['soundcloud'] };

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

// Without ODESLI_API_KEY the public API allows about 10 requests a minute; the server caches results.
export function fetchOdesli(sourceUrl, country = 'us') {
  const key = process.env.ODESLI_API_KEY ? `&key=${encodeURIComponent(process.env.ODESLI_API_KEY)}` : '';
  return fetchJson(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(sourceUrl)}&userCountry=${country.toUpperCase()}&songIfSingle=true${key}`, { timeout: 9000 });
}
