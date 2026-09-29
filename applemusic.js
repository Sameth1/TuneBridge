import crypto from 'node:crypto';
import { fetchJson } from './http.js';
import { cleanTrackUrl } from './lib.js';

// Official Apple Music API. Needs an Apple Developer Program membership and a MusicKit key:
// APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY (the .p8 file contents).
// Unlike the iTunes Search API it can look songs up by ISRC and allows far more requests.
let cached = { token: null, until: 0 };

const base64url = value => Buffer.from(value).toString('base64url');

export function developerToken(teamId, keyId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + 12 * 60 * 60 }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

export function appleMusicConfigured() {
  return Boolean(process.env.APPLE_MUSIC_TEAM_ID && process.env.APPLE_MUSIC_KEY_ID && process.env.APPLE_MUSIC_PRIVATE_KEY);
}

function token() {
  if (cached.until > Date.now()) return cached.token;
  // Hosting dashboards often store multi-line values with literal "\n".
  const key = process.env.APPLE_MUSIC_PRIVATE_KEY.replace(/\\n/g, '\n');
  cached = { token: developerToken(process.env.APPLE_MUSIC_TEAM_ID, process.env.APPLE_MUSIC_KEY_ID, key), until: Date.now() + 11 * 60 * 60 * 1000 };
  return cached.token;
}

export function appleMusicSong(item) {
  const a = item?.attributes;
  if (!a?.name) return null;
  return {
    title: a.name,
    artist: a.artistName,
    album: a.albumName,
    duration: a.durationInMillis || null,
    isrc: a.isrc || null,
    artwork: a.artwork?.url?.replace('{w}', '600').replace('{h}', '600') || null,
    url: cleanTrackUrl('apple', a.url)
  };
}

const request = (path, country) => fetchJson(`https://api.music.apple.com/v1/catalog/${encodeURIComponent(country)}${path}`, { headers: { Authorization: `Bearer ${token()}` } });

export async function appleMusicSongById(id, country) {
  const data = await request(`/songs/${encodeURIComponent(id)}`, country);
  return appleMusicSong(data.data?.[0]);
}

export async function appleMusicByIsrc(isrc, country) {
  const data = await request(`/songs?filter[isrc]=${encodeURIComponent(isrc)}`, country);
  return (data.data || []).map(appleMusicSong).filter(song => song?.url);
}

export async function searchAppleMusic(term, country) {
  const data = await request(`/search?types=songs&limit=25&term=${encodeURIComponent(term)}`, country);
  return (data.results?.songs?.data || []).map(appleMusicSong).filter(song => song?.url);
}
