import { PLATFORMS, parseMusicUrl, confidentMatch, searchLinks, normalize, sameTrackTitle } from './lib.js';
import { lookupSpotifyRecording, lookupIsrcRecording } from './musicbrainz.js';
import { artworkSignature, artworkSimilarity, selectArtworkCandidate } from './artwork.js';

async function json(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': 'TuneBridge/0.1 (music link resolver)', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function sourceMetadata(input) {
  switch (input.platform) {
    case 'apple': {
      const country = new URL(input.url).pathname.split('/').filter(Boolean)[0] || 'us';
      const data = await json(`https://itunes.apple.com/lookup?id=${input.id}&country=${encodeURIComponent(country)}&entity=song`);
      const track = data.results?.find(x => x.wrapperType === 'track' && String(x.trackId) === input.id);
      if (!track) throw new Error('Apple Music kataloğunda bu şarkı bulunamadı.');
      return { title: track.trackName, artist: track.artistName, album: track.collectionName, artwork: track.artworkUrl100?.replace('100x100bb', '600x600bb'), duration: track.trackTimeMillis, isrc: null, url: input.url };
    }
    case 'deezer': {
      const track = await json(`https://api.deezer.com/track/${input.id}`);
      if (!track.title || track.error) throw new Error('Deezer kataloğunda bu şarkı bulunamadı.');
      return { title: track.title, artist: track.artist?.name, album: track.album?.title, artwork: track.album?.cover_xl, duration: track.duration * 1000, isrc: track.isrc, url: input.url };
    }
    case 'spotify': {
      const access = await spotifyToken();
      if (access) {
        const track = await json(`https://api.spotify.com/v1/tracks/${input.id}`, { headers: { Authorization: `Bearer ${access}` } });
        return { title: track.name, artist: track.artists?.map(x => x.name).join(', '), album: track.album?.name, artwork: track.album?.images?.[0]?.url, duration: track.duration_ms, isrc: track.external_ids?.isrc, url: input.url };
      }
      const data = await json(`https://open.spotify.com/oembed?url=${encodeURIComponent(input.url)}`);
      return { title: data.title, artist: '', album: '', artwork: data.thumbnail_url, duration: null, isrc: null, url: input.url };
    }
    case 'youtube': {
      const data = await json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${input.id}`)}`);
      return { title: data.title, artist: '', album: '', artwork: data.thumbnail_url, duration: null, isrc: null, url: input.url };
    }
    case 'soundcloud': {
      const data = await json(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(input.url)}`);
      return { title: data.title, artist: data.author_name, album: '', artwork: data.thumbnail_url, duration: null, isrc: null, url: input.url };
    }
  }
}

let spotifyCached = { token: null, until: 0 };
async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spotifyCached.until > Date.now()) return spotifyCached.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const data = await json('https://accounts.spotify.com/api/token', {
    method: 'POST', body, headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  spotifyCached = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function appleSearch(query, country, limit = 20) {
  const data = await json(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=music&entity=song&limit=${limit}`);
  return (data.results || []).filter(track => track.wrapperType === 'track');
}

async function findApple(source, country) {
  const query = `${normalize(source.title)} ${source.artist.split(',')[0]}`;
  const candidates = await appleSearch(query, country);
  const matches = candidates.filter(track => confidentMatch(source, { title: track.trackName, artist: track.artistName, duration: track.trackTimeMillis }));
  matches.sort((a, b) => Math.abs(a.trackTimeMillis - source.duration) - Math.abs(b.trackTimeMillis - source.duration));
  if (matches.length > 1 && source.artwork) {
    const sourceImage = await artworkSignature(source.artwork);
    if (sourceImage) {
      const ranked = await Promise.all(matches.slice(0, 6).map(async track => ({
        track,
        similarity: artworkSimilarity(sourceImage, await artworkSignature(track.artworkUrl100?.replace('100x100bb', '300x300bb'))) || 0
      })));
      ranked.sort((a, b) => b.similarity - a.similarity);
      if (ranked[0]?.similarity >= 0.97) return { url: ranked[0].track.trackViewUrl, track: ranked[0].track };
    }
  }
  return matches[0] ? { url: matches[0].trackViewUrl, track: matches[0] } : null;
}

async function findAppleByArtwork(source, country) {
  const sourceImage = await artworkSignature(source.artwork);
  if (!sourceImage) return null;
  const candidates = (await appleSearch(normalize(source.title), country, 30))
    .filter(track => sameTrackTitle(source.title, track.trackName) && track.artworkUrl100).slice(0, 15);
  const scored = await Promise.all(candidates.map(async track => {
    const image = await artworkSignature(track.artworkUrl100.replace('100x100bb', '300x300bb'));
    return { track, similarity: artworkSimilarity(sourceImage, image) || 0 };
  }));
  const winner = selectArtworkCandidate(scored);
  if (!winner) return null;
  return { url: winner.track.trackViewUrl, track: winner.track, similarity: winner.similarity };
}

async function findDeezer(source) {
  const query = `${normalize(source.title)} ${source.artist.split(',')[0]}`;
  const data = await json(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`);
  const matches = (data.data || []).filter(track => confidentMatch(source, { title: track.title, artist: track.artist?.name, duration: track.duration * 1000, isrc: track.isrc }));
  matches.sort((a, b) => Math.abs(a.duration * 1000 - source.duration) - Math.abs(b.duration * 1000 - source.duration));
  return matches[0] ? { url: matches[0].link.replace(/^http:/, 'https:'), track: matches[0] } : null;
}

async function findSpotify(source) {
  const token = await spotifyToken();
  if (!token) return null;
  const data = await json(`https://api.spotify.com/v1/search?q=${encodeURIComponent(`${source.title} ${source.artist}`)}&type=track&limit=10`, { headers: { Authorization: `Bearer ${token}` } });
  const found = data.tracks?.items?.find(track => confidentMatch(source, { title: track.name, artist: track.artists?.map(x => x.name).join(', '), duration: track.duration_ms, isrc: track.external_ids?.isrc }));
  return found?.external_urls?.spotify || null;
}

export async function resolveMusicUrl(rawUrl, country = 'us') {
  const input = parseMusicUrl(rawUrl);
  const song = await sourceMetadata(input);
  const mapping = input.platform === 'spotify' ? await lookupSpotifyRecording(input, song.title, country).catch(() => null) : null;
  if (!song.artist && mapping?.artist) song.artist = mapping.artist;
  if (!song.duration && mapping?.duration) song.duration = mapping.duration;
  if (!song.isrc && mapping?.isrcs?.length) song.isrc = mapping.isrcs[0];
  const exact = { ...mapping?.links, [input.platform]: input.url };
  let artworkMatch = false;
  if (!song.artist && song.artwork) {
    const fromArtwork = await findAppleByArtwork(song, country).catch(() => null);
    if (fromArtwork) {
      artworkMatch = true;
      song.artist = fromArtwork.track.artistName;
      song.album = fromArtwork.track.collectionName;
      song.duration = fromArtwork.track.trackTimeMillis;
      exact.apple = fromArtwork.url;
    }
  }
  if (song.artist) {
    const tasks = [
      input.platform === 'apple' || artworkMatch ? null : ['apple', findApple(song, country)],
      input.platform === 'deezer' ? null : ['deezer', findDeezer(song)],
      input.platform === 'spotify' ? null : ['spotify', findSpotify(song)]
    ].filter(Boolean);
    const results = await Promise.allSettled(tasks.map(x => x[1]));
    results.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const platform = tasks[i][0];
      exact[platform] = typeof result.value === 'string' ? result.value : result.value.url;
      if (platform === 'apple' && result.value.track) {
        song.album ||= result.value.track.collectionName;
        song.duration ||= result.value.track.trackTimeMillis;
      }
      if (platform === 'deezer' && !song.isrc) song.isrc = result.value.track.isrc;
    });
  }
  if (song.isrc && !exact.spotify) {
    const fromIsrc = await lookupIsrcRecording(song.isrc, song, country).catch(() => null);
    for (const [platform, url] of Object.entries(fromIsrc?.links || {})) exact[platform] ||= url;
  }
  const links = searchLinks(song.title, song.artist);
  return {
    song: { title: song.title, artist: song.artist, album: song.album, artwork: song.artwork, duration: song.duration },
    sourcePlatform: input.platform,
    platforms: PLATFORMS.map(platform => ({ ...platform, url: exact[platform.id] || links[platform.id], exact: Boolean(exact[platform.id]) }))
  };
}
