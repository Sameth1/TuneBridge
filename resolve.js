import { UserError, PLATFORMS, parseMusicUrl, isShortMusicLink, confidentMatch, selectUniqueTitleArtist, searchLinks, normalize, sameTrackTitle, artistsOverlap, cleanTrackUrl, youtubeUrl } from './lib.js';
import { fetchJson, followRedirects } from './http.js';
import { lookupSpotifyRecording, lookupIsrcRecording } from './musicbrainz.js';
import { artworkSignature, artworkSimilarity, selectArtworkCandidate } from './artwork.js';
import { spotifyMetadata, searchSpotify } from './spotify.js';
import { youtubeMetadata, searchYoutubeMusic, searchYoutubeVideos } from './youtube.js';
import { soundcloudMetadata, searchSoundcloud } from './soundcloud.js';
import { fetchOdesli, odesliLinks } from './odesli.js';
import { appleMusicConfigured, appleMusicSongById, appleMusicByIsrc, searchAppleMusic } from './applemusic.js';

async function sourceMetadata(input) {
  switch (input.platform) {
    case 'apple': {
      const country = new URL(input.url).pathname.split('/').filter(Boolean)[0] || 'us';
      if (appleMusicConfigured()) {
        // The Apple Music API also returns the ISRC, which makes every other platform an exact lookup.
        const song = await appleMusicSongById(input.id, country).catch(() => null);
        if (song) return song;
      }
      const data = await itunes(`https://itunes.apple.com/lookup?id=${input.id}&country=${encodeURIComponent(country)}&entity=song`);
      const track = data.results?.find(x => x.wrapperType === 'track' && String(x.trackId) === input.id);
      if (!track) throw new UserError('apple_not_found', 'This song was not found in the Apple Music catalog.');
      return { title: track.trackName, artist: track.artistName, album: track.collectionName, artwork: track.artworkUrl100?.replace('100x100bb', '600x600bb'), duration: track.trackTimeMillis, isrc: null };
    }
    case 'deezer': {
      const track = await fetchJson(`https://api.deezer.com/track/${input.id}`);
      if (!track.title || track.error) throw new UserError('deezer_not_found', 'This song was not found in the Deezer catalog.');
      return deezerSong(track);
    }
    case 'spotify': return spotifyMetadata(input);
    case 'youtube':
    case 'youtubeMusic': return youtubeMetadata(input.id);
    case 'soundcloud': return soundcloudMetadata(input.url);
  }
}

function deezerSong(track) {
  return { title: track.title, artist: track.artist?.name, album: track.album?.title, artwork: track.album?.cover_xl, duration: track.duration * 1000, isrc: track.isrc || null, url: track.link?.replace(/^http:/, 'https:') };
}

function appleSong(track) {
  return { title: track.trackName, artist: track.artistName, album: track.collectionName, duration: track.trackTimeMillis, isrc: null, url: cleanTrackUrl('apple', track.trackViewUrl), track };
}

const query = song => `${normalize(song.title)} ${song.artist.split(',')[0]}`;

// Strict matches first: same ISRC, then candidates that carry an ISRC (official releases), then closest duration.
function rankMatches(song, candidates) {
  const score = candidate => (song.isrc && candidate.isrc === song.isrc ? 0 : candidate.isrc ? 1 : 2);
  return candidates.filter(candidate => candidate.url && confidentMatch(song, candidate)).sort((a, b) =>
    score(a) - score(b) || Math.abs((a.duration || 0) - song.duration) - Math.abs((b.duration || 0) - song.duration));
}

function pickCandidate(song, candidates) {
  const strict = rankMatches(song, candidates);
  if (strict.length) return strict[0];
  return song.durationReliable === false || !song.duration ? selectUniqueTitleArtist(song, candidates.filter(c => c.url)) : null;
}

// iTunes Search allows roughly 20 requests a minute per IP and answers 403 beyond that:
// keep under the limit by waiting briefly, retry a 403 once, and reuse recent answers.
const appleCache = new Map();
const itunesCalls = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function itunes(url) {
  const now = Date.now();
  while (itunesCalls.length && itunesCalls[0] <= now - 60_000) itunesCalls.shift();
  if (itunesCalls.length >= 18) {
    const wait = itunesCalls[0] + 60_000 - now;
    if (wait > 8000) throw new Error('iTunes rate limit');
    await sleep(wait);
  }
  itunesCalls.push(Date.now());
  try { return await fetchJson(url); }
  catch (error) {
    if (!/HTTP 403/.test(error.message)) throw error;
    await sleep(2000);
    return fetchJson(url);
  }
}

async function appleSearch(term, country, limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&entity=song&limit=${limit}`;
  const cached = appleCache.get(url);
  if (cached && cached.until > Date.now()) return cached.results;
  const data = await itunes(url);
  const results = (data.results || []).filter(track => track.wrapperType === 'track');
  if (appleCache.size >= 500) appleCache.delete(appleCache.keys().next().value);
  appleCache.set(url, { results, until: Date.now() + 60 * 60 * 1000 });
  return results;
}

async function findApple(song, country) {
  if (appleMusicConfigured()) {
    const official = await findAppleMusic(song, country).catch(() => null);
    if (official) return official;
  }
  const candidates = (await appleSearch(query(song), country)).map(appleSong);
  const matches = rankMatches(song, candidates);
  if (matches.length > 1 && song.artwork) {
    const sourceImage = await artworkSignature(song.artwork);
    if (sourceImage) {
      const ranked = await Promise.all(matches.slice(0, 6).map(async candidate => ({
        candidate,
        similarity: artworkSimilarity(sourceImage, await artworkSignature(candidate.track.artworkUrl100?.replace('100x100bb', '300x300bb'))) || 0
      })));
      ranked.sort((a, b) => b.similarity - a.similarity);
      if (ranked[0]?.similarity >= 0.97) return ranked[0].candidate;
    }
  }
  return matches[0] || pickCandidate(song, candidates);
}

async function findAppleMusic(song, country) {
  if (song.isrc) {
    const byIsrc = rankMatches(song, await appleMusicByIsrc(song.isrc, country));
    if (byIsrc.length) return byIsrc[0];
  }
  return pickCandidate(song, await searchAppleMusic(query(song), country));
}

async function findAppleByArtwork(song, country) {
  const sourceImage = await artworkSignature(song.artwork);
  if (!sourceImage) return null;
  const candidates = (await appleSearch(normalize(song.title), country, 30))
    .filter(track => sameTrackTitle(song.title, track.trackName) && track.artworkUrl100).slice(0, 15);
  const scored = await Promise.all(candidates.map(async track => {
    const image = await artworkSignature(track.artworkUrl100.replace('100x100bb', '300x300bb'));
    return { track, similarity: artworkSimilarity(sourceImage, image) || 0 };
  }));
  const winner = selectArtworkCandidate(scored);
  return winner ? appleSong(winner.track) : null;
}

async function findDeezer(song) {
  if (song.isrc) {
    // An ISRC identifies the exact recording, so this lookup needs no fuzzy comparison.
    const track = await fetchJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(song.isrc)}`).catch(() => null);
    const agrees = track?.id && !track.error && track.isrc?.toUpperCase() === song.isrc.toUpperCase() &&
      (sameTrackTitle(song.title, track.title) || artistsOverlap(song.artist, track.artist?.name));
    if (agrees) return deezerSong(track);
  }
  const data = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(query(song))}&limit=15`);
  return pickCandidate(song, (data.data || []).map(deezerSong));
}

const findSpotify = async song => pickCandidate(song, await searchSpotify(song));
const asTarget = (platform, candidates) => candidates.map(candidate => ({ ...candidate, url: youtubeUrl(platform, candidate.videoId) }));

// YouTube Music: the song itself — its "Songs" search, then the auto-generated Topic upload, then the official video.
async function findYoutubeMusic(song, country, videos) {
  const fromMusic = pickCandidate(song, await searchYoutubeMusic(query(song), country).catch(() => []));
  if (fromMusic) return fromMusic;
  const uploads = asTarget('youtubeMusic', await videos());
  return pickCandidate(song, uploads.filter(video => video.topic)) || pickCandidate(song, uploads) || closestOfficialVideo(song, uploads);
}

// YouTube: the artist's official music video first, then the Topic upload of the song.
async function findYoutube(song, country, videos) {
  const uploads = asTarget('youtube', await videos());
  return closestOfficialVideo(song, uploads.filter(video => !video.topic)) || pickCandidate(song, uploads);
}

// An official music video of the same song can run longer than the track (intro, outro), so allow up to 90 s.
function closestOfficialVideo(song, videos) {
  if (!song.duration) return null;
  return videos
    .filter(video => sameTrackTitle(song.title, video.title) && artistsOverlap(song.artist, video.artist) && video.duration &&
      Math.abs(video.duration - song.duration) <= 90_000)
    .sort((a, b) => Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration))[0] || null;
}
const findSoundcloud = async song => pickCandidate(song, await searchSoundcloud(query(song)));

const acceptsTrackUrl = url => { try { parseMusicUrl(url); return true; } catch { return false; } };

export async function resolveMusicUrl(rawUrl, country = 'us') {
  const source = isShortMusicLink(rawUrl) ? await followRedirects(String(rawUrl).trim(), acceptsTrackUrl) : rawUrl;
  const input = parseMusicUrl(source);
  const song = { durationReliable: true, ...await sourceMetadata(input) };
  const exact = { [input.platform]: input.url };
  const add = links => { for (const [platform, url] of Object.entries(links || {})) exact[platform] ||= url; };

  const [mapping, odesli] = await Promise.all([
    input.platform === 'spotify' ? lookupSpotifyRecording(input, song.title, country).catch(() => null) : null,
    fetchOdesli(input.url, country).catch(() => null)
  ]);
  if (!song.artist && mapping?.artist) song.artist = mapping.artist;
  if (!song.duration && mapping?.duration) song.duration = mapping.duration;
  if (!song.isrc && mapping?.isrcs?.length) song.isrc = mapping.isrcs[0];
  add(mapping?.links);
  if (odesli) {
    const verified = odesliLinks(odesli, song);
    if (!song.artist && verified.artist) song.artist = verified.artist;
    add(verified.links);
  }

  if (!song.artist && song.artwork) {
    const fromArtwork = await findAppleByArtwork(song, country).catch(() => null);
    if (fromArtwork) {
      Object.assign(song, { artist: fromArtwork.artist, album: fromArtwork.album, duration: fromArtwork.duration, durationReliable: true });
      exact.apple ||= fromArtwork.url;
    }
  }

  const knownIsrc = song.isrc;
  if (song.artist) {
    let videoSearch;
    const videos = () => (videoSearch ||= searchYoutubeVideos(query(song), country).catch(() => []));
    const searches = {
      apple: () => findApple(song, country), deezer: () => findDeezer(song), spotify: () => findSpotify(song),
      youtubeMusic: () => findYoutubeMusic(song, country, videos), youtube: () => findYoutube(song, country, videos),
      soundcloud: () => findSoundcloud(song)
    };
    const tasks = Object.entries(searches).filter(([platform]) => !exact[platform]);
    const results = await Promise.allSettled(tasks.map(([, find]) => find()));
    const found = {};
    results.forEach((result, i) => { if (result.status === 'fulfilled' && result.value?.url) found[tasks[i][0]] = result.value; });
    add(Object.fromEntries(Object.entries(found).map(([platform, match]) => [platform, match.url])));
    // A catalog release is a better source of album, duration and ISRC than a video page.
    const reference = found.apple || found.deezer || found.spotify;
    if (reference) {
      song.album ||= reference.album;
      // A video title is a guess ("Artist - Title (Official Video)"); the catalog title is the real one.
      if (!song.durationReliable && reference.title) song.title = reference.title;
      if (!song.duration || !song.durationReliable) Object.assign(song, { duration: reference.duration || song.duration, durationReliable: true });
    }
    song.isrc ||= found.deezer?.isrc || found.spotify?.isrc || found.soundcloud?.isrc || null;
  }

  if (song.isrc && PLATFORMS.some(platform => !exact[platform.id])) {
    const fromIsrc = await lookupIsrcRecording(song.isrc, song, country).catch(() => null);
    add(fromIsrc?.links);
  }
  // The catalog searches above ran without this ISRC; retry the ISRC-capable catalogs once.
  if (song.isrc && song.isrc !== knownIsrc) {
    if (!exact.deezer) { const match = await findDeezer(song).catch(() => null); if (match?.url) exact.deezer = match.url; }
    if (!exact.spotify) { const match = await findSpotify(song).catch(() => null); if (match?.url) exact.spotify = match.url; }
  }

  // The same video id plays on both YouTube sites, so a match on one is an exact link for the other.
  for (const [from, to] of [['youtubeMusic', 'youtube'], ['youtube', 'youtubeMusic']]) {
    const id = exact[from] && new URL(exact[from]).searchParams.get('v');
    if (id && !exact[to]) exact[to] = youtubeUrl(to, id);
  }

  const links = searchLinks(song.title, song.artist);
  return {
    song: { title: song.title, artist: song.artist, album: song.album, artwork: song.artwork, duration: song.duration },
    sourcePlatform: input.platform,
    platforms: PLATFORMS.map(platform => ({ ...platform, url: exact[platform.id] || links[platform.id], exact: Boolean(exact[platform.id]) }))
  };
}
