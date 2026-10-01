import { fetchJson } from './http.js';

export function deezerSong(track) {
  return { title: track.title, artist: track.artist?.name, album: track.album?.title, artwork: track.album?.cover_xl, duration: track.duration * 1000, isrc: track.isrc || null, url: track.link?.replace(/^http:/, 'https:'), id: track.id };
}

export async function searchDeezer(query, limit = 15) {
  const data = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`, { retry: true }).catch(() => ({}));
  return (data.data || []).map(deezerSong);
}

// Search results leave out the ISRC; the track record has it.
export async function deezerTrack(id) {
  const track = await fetchJson(`https://api.deezer.com/track/${id}`, { retry: true }).catch(() => null);
  return track?.id && !track.error ? deezerSong(track) : null;
}
