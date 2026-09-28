import { fetchJson } from './http.js';

// ListenBrainz Labs maps artist + track names to streaming ids from MusicBrainz and listening data.
// It needs no key; every id it returns is still checked against the platform before use.
const SERVICES = {
  spotify: ['spotify-id-from-metadata', 'spotify_track_ids'],
  apple: ['apple-music-id-from-metadata', 'apple_music_track_ids'],
  soundcloud: ['soundcloud-id-from-metadata', 'soundcloud_track_ids']
};

async function lookup(service, artist, title) {
  const [endpoint, key] = SERVICES[service];
  const params = new URLSearchParams({ artist_name: artist, release_name: '', track_name: title });
  const data = await fetchJson(`https://labs.api.listenbrainz.org/${endpoint}/json?${params}`, { retry: true });
  return data?.[0]?.[key] || [];
}

export async function listenbrainzIds(service, song) {
  if (!song.title || !song.artist) return [];
  const ids = await lookup(service, song.artist, song.title);
  const primary = song.artist.split(/,|&| feat\.? | ft\.? /i)[0].trim();
  if (!ids.length && primary && primary !== song.artist) ids.push(...await lookup(service, primary, song.title));
  return [...new Set(ids.map(String))].slice(0, 5);
}
