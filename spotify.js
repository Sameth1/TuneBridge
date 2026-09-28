import { fetchJson, fetchText, findDeep } from './http.js';
import { listenbrainzIds } from './listenbrainz.js';

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

function nextData(html) {
  const script = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  try { return script ? JSON.parse(script) : null; } catch { return null; }
}

const largestImage = entity => [...(entity.visualIdentity?.image || entity.coverArt?.sources || [])]
  .sort((a, b) => (b.maxWidth || b.width || 0) - (a.maxWidth || a.width || 0))[0]?.url || null;

// The public embed player page ships the track's artists and duration in __NEXT_DATA__.
export function parseEmbed(html) {
  const data = nextData(html);
  if (!data) return null;
  const entity = findDeep(data, value => String(value.uri || '').startsWith('spotify:track:') && Array.isArray(value.artists));
  if (!entity) return null;
  return {
    title: entity.name || entity.title,
    artist: entity.artists.map(artist => artist.name).filter(Boolean).join(', '),
    album: '',
    artwork: largestImage(entity),
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
    const [embed, page] = await Promise.all([
      fetchText(`https://open.spotify.com/embed/track/${input.id}`, { retry: true }),
      fetchText(`https://open.spotify.com/track/${input.id}`).catch(() => '')
    ]);
    const song = parseEmbed(embed);
    // The track page's description reads "Artist · Album · Song · Year"; the album helps pick the same release elsewhere.
    const description = page.match(/<meta property="og:description" content="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&').split(' · ') || [];
    if (song?.title && song.artist) return { ...song, album: description.length >= 3 ? description[description.length - 3] : '' };
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

// Without API credentials: ListenBrainz suggests track ids, and each one is read back from its
// embed page so the usual title / artist / duration checks decide.
export async function spotifyTrackById(id) {
  const song = parseEmbed(await fetchText(`https://open.spotify.com/embed/track/${id}`, { retry: true }));
  return song && { ...song, url: `https://open.spotify.com/track/${id}` };
}

export async function searchSpotifyKeyless(song) {
  const ids = await listenbrainzIds('spotify', song).catch(() => []);
  return (await Promise.all(ids.map(id => spotifyTrackById(id).catch(() => null)))).filter(Boolean);
}

export function parseAlbumEmbed(html) {
  const data = nextData(html);
  const entity = data && findDeep(data, value => String(value.uri || '').startsWith('spotify:album:') && Array.isArray(value.trackList));
  if (!entity) return null;
  return {
    title: entity.name || entity.title,
    artist: entity.subtitle || '',
    trackCount: entity.trackList.length || null,
    year: entity.releaseDate?.isoString?.slice(0, 4) || null,
    artwork: largestImage(entity),
    upc: null,
    tracks: entity.trackList.map(track => ({ title: track.title, artist: track.subtitle, duration: track.duration || null }))
  };
}

export async function spotifyAlbumById(id) {
  const album = parseAlbumEmbed(await fetchText(`https://open.spotify.com/embed/album/${id}`, { retry: true }));
  return album && { ...album, url: `https://open.spotify.com/album/${id}` };
}

// A track page names its album in <meta name="music:album">, which leads from a track to its album.
export async function spotifyAlbumIdOfTrack(trackId) {
  const html = await fetchText(`https://open.spotify.com/track/${trackId}`, { retry: true });
  return html.match(/<meta name="music:album" content="https:\/\/open\.spotify\.com\/album\/([A-Za-z0-9]{22})"/)?.[1] || null;
}

export async function searchSpotifyAlbums(album) {
  const token = await spotifyToken().catch(() => null);
  if (!token) return [];
  const data = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(`${album.title} ${album.artist}`)}&type=album&limit=10`, { headers: { Authorization: `Bearer ${token}` } });
  return (data.albums?.items || []).map(item => ({
    title: item.name, artist: item.artists?.map(x => x.name).join(', '), trackCount: item.total_tracks,
    year: item.release_date?.slice(0, 4) || null, upc: null, url: item.external_urls?.spotify
  })).filter(item => item.url);
}
