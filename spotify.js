import { fetchJson, fetchText, findDeep } from './http.js';

let cached = { token: null, until: 0 };

export async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cached.until > Date.now()) return cached.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const data = await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST', body, headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  cached = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

function apiSong(track) {
  return {
    title: track.name,
    artist: track.artists?.map(x => x.name).join(', '),
    album: track.album?.name,
    artwork: track.album?.images?.[0]?.url,
    duration: track.duration_ms,
    isrc: track.external_ids?.isrc || null,
    url: track.external_urls?.spotify || null
  };
}

// The public embed player page ships the track's artists and duration in __NEXT_DATA__.
export function parseEmbed(html) {
  const script = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) return null;
  let data;
  try { data = JSON.parse(script); } catch { return null; }
  const entity = findDeep(data, value => String(value.uri || '').startsWith('spotify:track:') && Array.isArray(value.artists));
  if (!entity) return null;
  const images = entity.visualIdentity?.image || entity.coverArt?.sources || [];
  const artwork = [...images].sort((a, b) => (b.maxWidth || b.width || 0) - (a.maxWidth || a.width || 0))[0]?.url || null;
  return {
    title: entity.name || entity.title,
    artist: entity.artists.map(artist => artist.name).filter(Boolean).join(', '),
    album: '',
    artwork,
    duration: Number(entity.duration) || null,
    isrc: null
  };
}

export async function spotifyMetadata(input) {
  const token = await spotifyToken().catch(() => null);
  if (token) {
    try { return apiSong(await fetchJson(`https://api.spotify.com/v1/tracks/${input.id}`, { headers: { Authorization: `Bearer ${token}` } })); }
    catch { /* Fall back to public pages. */ }
  }
  try {
    const song = parseEmbed(await fetchText(`https://open.spotify.com/embed/track/${input.id}`));
    if (song?.title && song.artist) return song;
  } catch { /* Fall back to oEmbed below. */ }
  const data = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(input.url)}`);
  return { title: data.title, artist: '', album: '', artwork: data.thumbnail_url, duration: null, isrc: null };
}

export async function searchSpotify(song) {
  const token = await spotifyToken();
  if (!token) return [];
  const search = async query => (await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`, { headers: { Authorization: `Bearer ${token}` } })).tracks?.items || [];
  let items = song.isrc ? await search(`isrc:${song.isrc}`) : [];
  if (!items.length) items = await search(`${song.title} ${song.artist}`);
  return items.map(apiSong).filter(candidate => candidate.url);
}
