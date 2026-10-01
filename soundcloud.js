import { fetchJson, fetchText, extractJsonAfter } from './http.js';
import { splitArtistTitle } from './lib.js';

// SoundCloud track data for both the page hydration blob and api-v2 search results.
export function soundcloudSong(track) {
  if (!track?.title) return null;
  const publisher = track.publisher_metadata || {};
  const split = publisher.artist ? null : splitArtistTitle(track.title);
  const artwork = (track.artwork_url || track.user?.avatar_url || '').replace('-large.', '-t500x500.') || null;
  return {
    title: split?.title || track.title,
    artist: publisher.artist || split?.artist || track.user?.username || '',
    album: publisher.album_title || '',
    duration: track.full_duration || track.duration || null,
    isrc: /^[A-Z0-9]{12}$/i.test(publisher.isrc || '') ? publisher.isrc.toUpperCase() : null,
    artwork,
    url: track.permalink_url || null,
    uploader: track.user?.username || '',
    // Distributor and label releases carry an ISRC or UPC and earn through ads or subscriptions; re-uploads only get
    // the artist name SoundCloud's content matching adds. Anything else is trusted only from the artist's own account.
    distributed: Boolean(publisher.isrc || publisher.upc_or_ean || ['AD_SUPPORTED', 'SUB_HIGH_TIER'].includes(track.monetization_model)),
    // SoundCloud's content matching recognised the recording in someone's upload: never exact, at most the closest.
    recognised: Boolean(publisher.artist && publisher.album_title),
    durationReliable: true
  };
}

export function parseHydration(html) {
  const hydration = extractJsonAfter(html, 'window.__sc_hydration = ');
  const sound = Array.isArray(hydration) ? hydration.find(entry => entry?.hydratable === 'sound') : null;
  return soundcloudSong(sound?.data);
}

export async function soundcloudMetadata(url) {
  try {
    const song = parseHydration(await fetchText(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }));
    if (song) return song;
  } catch { /* Fall back to oEmbed below. */ }
  const data = await fetchJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  const title = String(data.title || '').replace(new RegExp(` by ${(data.author_name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  const split = splitArtistTitle(title);
  return { title: split?.title || title, artist: split?.artist || data.author_name || '', album: '', duration: null, isrc: null, artwork: data.thumbnail_url, durationReliable: false };
}

let clientId = { value: null, until: 0 };

export function findClientId(script) {
  return script.match(/client_id\s*[:=]\s*"([A-Za-z0-9]{32})"/)?.[1] || null;
}

// The public web player embeds its api-v2 client_id in one of its JavaScript bundles.
export async function soundcloudClientId() {
  if (process.env.SOUNDCLOUD_CLIENT_ID) return process.env.SOUNDCLOUD_CLIENT_ID;
  if (clientId.until > Date.now()) return clientId.value;
  const html = await fetchText('https://soundcloud.com/').catch(() => '');
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(match => match[1]).reverse().slice(0, 6);
  const bundles = await Promise.all(scripts.map(src => fetchText(src).catch(() => '')));
  const found = bundles.map(findClientId).find(Boolean) || null;
  // Remember a failure briefly too, so a SoundCloud outage does not slow every request.
  clientId = { value: found, until: Date.now() + (found ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000) };
  return found;
}

export async function searchSoundcloud(query) {
  const id = await soundcloudClientId();
  if (!id) return [];
  const data = await fetchJson(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${id}&limit=20`)
    .catch(error => { clientId.until = 0; throw error; });
  return (data.collection || []).map(soundcloudSong).filter(song => song?.url);
}

export function soundcloudAlbum(set) {
  if (!set?.title) return null;
  return {
    title: set.title,
    artist: set.publisher_metadata?.artist || set.user?.username || '',
    trackCount: set.track_count || null,
    year: (set.release_date || set.published_at || set.created_at || '').slice(0, 4) || null,
    upc: set.publisher_metadata?.upc_or_ean || null,
    artwork: (set.artwork_url || '').replace('-large.', '-t500x500.') || null,
    url: set.permalink_url || null,
    tracks: []
  };
}

export async function soundcloudAlbumMetadata(url) {
  const hydration = extractJsonAfter(await fetchText(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }), 'window.__sc_hydration = ');
  const set = Array.isArray(hydration) ? hydration.find(entry => entry?.hydratable === 'playlist')?.data : null;
  const album = soundcloudAlbum(set);
  if (!album) throw new Error('SoundCloud set not found');
  album.tracks = (set.tracks || []).filter(track => track.title).slice(0, 3).map(soundcloudSong);
  return album;
}

export async function searchSoundcloudAlbums(query) {
  const id = await soundcloudClientId();
  if (!id) return [];
  const data = await fetchJson(`https://api-v2.soundcloud.com/search/albums?q=${encodeURIComponent(query)}&client_id=${id}&limit=20`);
  return (data.collection || []).map(soundcloudAlbum).filter(album => album?.url);
}
