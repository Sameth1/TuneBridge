import { UserError, PLATFORMS, parseMusicUrl, splitArtistTitle, spelledMatch, versionTags, isShortMusicLink, confidentMatch, selectUniqueTitleArtist, searchLinks, normalize, sameTrackTitle, sameAlbumTitle, artistsOverlap, compactName, cleanTrackUrl, youtubeUrl, titleVariants, matchScore } from './lib.js';
import { fetchJson, followRedirects } from './http.js';
import { lookupSpotifyRecording, lookupIsrcRecording } from './musicbrainz.js';
import { artworkSignature, artworkSimilarity, selectArtworkCandidate } from './artwork.js';
import { spotifyMetadata, searchSpotify, searchSpotifyKeyless, spotifyCatalogTracks } from './spotify.js';
import { youtubeMetadata, searchYoutubeMusic, searchYoutubeVideos } from './youtube.js';
import { soundcloudMetadata, searchSoundcloud } from './soundcloud.js';
import { fetchOdesli, odesliLinks } from './odesli.js';
import { appleMusicConfigured, appleMusicSongById, appleMusicByIsrc, searchAppleMusic } from './applemusic.js';
import { itunesSearch, itunesLookup, appleSong, applePageSong, appleWebSearch } from './apple.js';
import { listenbrainzIds } from './listenbrainz.js';
import { resolveAlbum } from './albums.js';
import { deezerSong } from './deezer.js';
import { identifyUpload, uploadSearches } from './identify.js';

async function sourceMetadata(input) {
  switch (input.platform) {
    case 'apple': {
      const country = new URL(input.url).pathname.split('/').filter(Boolean)[0] || 'us';
      if (appleMusicConfigured()) {
        // The Apple Music API also returns the ISRC, which makes every other platform an exact lookup.
        const song = await appleMusicSongById(input.id, country).catch(() => null);
        if (song) return song;
      }
      const results = await itunesLookup([input.id], country).catch(() => null);
      const track = results?.find(x => x.wrapperType === 'track' && String(x.trackId) === input.id);
      if (!track) {
        // iTunes rate-limited or missing the song: Apple's own song page has title, artist and duration.
        const page = await applePageSong(input.id, country).catch(() => null);
        if (page) return page;
        throw new UserError('apple_not_found', 'This song was not found in the Apple Music catalog.');
      }
      return { title: track.trackName, artist: track.artistName, album: track.collectionName, artwork: track.artworkUrl100?.replace('100x100bb', '600x600bb'), duration: track.trackTimeMillis, isrc: null };
    }
    case 'deezer': {
      const track = await fetchJson(`https://api.deezer.com/track/${input.id}`, { retry: true });
      if (!track.title || track.error) throw new UserError('deezer_not_found', 'This song was not found in the Deezer catalog.');
      return deezerSong(track);
    }
    case 'spotify': return spotifyMetadata(input);
    case 'youtube':
    case 'youtubeMusic': return youtubeMetadata(input.id);
    case 'soundcloud': return soundcloudMetadata(input.url);
  }
}

const primary = artist => String(artist || '').split(',')[0].trim();
const variantsOf = song => (song.titleVariants?.length ? song.titleVariants : [song.title]);
const asVariants = song => variantsOf(song).map(title => ({ ...song, title }));
const query = song => `${normalize(song.title)} ${primary(song.artist)}`;
// Search phrasings for the song's names ("Nour El Ain", "Nour El Ein", "نور العين"), most likely first.
// A versioned name ("Belki (Akustik)") is searched with its version words too, or catalogs rank the original first.
const withVersion = title => (versionTags(title) ? String(title).replace(/[^\p{L}\p{N}'’]+/gu, ' ').replace(/\s+(feat|ft|featuring)\s.*$/i, '').trim() : null);
const queries = (song, limit = 2) => [...new Set(variantsOf(song).slice(0, limit)
  .flatMap(title => [withVersion(title), normalize(title)]).filter(Boolean).map(title => `${title} ${primary(song.artist)}`))];

// Strict matches first: same ISRC, then candidates that carry an ISRC (official releases),
// then the release on the source's album (not a later single or compilation), then closest duration.
function rankMatches(song, candidates) {
  const score = candidate => (song.isrc && candidate.isrc === song.isrc ? 0 : candidate.isrc ? 1 : 2);
  const sameAlbum = candidate => (song.album && candidate.album && sameAlbumTitle(song.album, candidate.album) ? 0 : 1);
  return candidates.filter(candidate => candidate.url && asVariants(song).some(variant => confidentMatch(variant, candidate))).sort((a, b) =>
    score(a) - score(b) || sameAlbum(a) - sameAlbum(b) ||
    Math.abs((a.duration || 0) - song.duration) - Math.abs((b.duration || 0) - song.duration));
}

function pickCandidate(song, candidates) {
  const strict = rankMatches(song, candidates);
  if (strict.length) return strict[0];
  if (song.durationReliable !== false) {
    const spelled = candidates.filter(candidate => candidate.url && asVariants(song).some(variant => spelledMatch(variant, candidate)))
      .sort((a, b) => Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration))[0];
    if (spelled) return spelled;
  }
  if (song.durationReliable !== false && song.duration) return null;
  for (const variant of asVariants(song)) {
    const unique = selectUniqueTitleArtist(variant, candidates.filter(c => c.url));
    if (unique) return unique;
  }
  return null;
}

// Collects every candidate a platform search saw. Exact matches are taken as soon as they appear;
// otherwise the closest one (score ≥ 0.78 on name, artist, length and cover) comes back marked `close`.
function matcher(song) {
  const seen = [];
  return {
    exact(candidates) { seen.push(...candidates); return pickCandidate(song, candidates); },
    see(candidates) { seen.push(...candidates); },
    async closest() {
      const ranked = seen.filter(candidate => candidate?.url)
        .map(candidate => ({ candidate, ...matchScore(song, candidate) }))
        .filter(entry => entry.title >= 0.72 && entry.artist >= 0.6 && entry.score >= 0.7)
        .sort((a, b) => b.score - a.score).slice(0, 3);
      if (!ranked.length) return null;
      // Near-identical cover art supports a candidate; only catalog covers are compared, not video frames.
      const source = song.artwork ? await artworkSignature(song.artwork).catch(() => null) : null;
      if (source) {
        await Promise.all(ranked.map(async entry => {
          const similarity = artworkSimilarity(source, await artworkSignature(entry.candidate.artwork).catch(() => null)) || 0;
          entry.score += similarity >= 0.95 ? 0.08 : similarity >= 0.9 ? 0.04 : 0;
        }));
        ranked.sort((a, b) => b.score - a.score);
      }
      const best = ranked[0];
      return best.score >= 0.78 ? { ...best.candidate, close: true, score: Math.min(1, best.score) } : null;
    }
  };
}

async function findApple(song, country) {
  if (appleMusicConfigured()) {
    const official = await findAppleMusic(song, country).catch(() => null);
    if (official && !official.close) return official;
  }
  const pool = matcher(song);
  for (const phrase of queries(song)) {
    const candidates = (await itunesSearch(phrase, country).catch(() => [])).map(appleSong);
    const matches = rankMatches(song, candidates);
    if (matches.length > 1 && song.artwork) {
      const sourceImage = await artworkSignature(song.artwork);
      if (sourceImage) {
        const ranked = await Promise.all(matches.slice(0, 6).map(async candidate => ({
          candidate,
          similarity: artworkSimilarity(sourceImage, await artworkSignature(candidate.artwork)) || 0
        })));
        ranked.sort((a, b) => b.similarity - a.similarity);
        if (ranked[0]?.similarity >= 0.97) return ranked[0].candidate;
      }
    }
    const found = pool.exact(candidates);
    if (found) return found;
  }
  // The title alone finds songs whose artist is spelled differently on Apple (another script, "&" vs ",").
  const byTitle = pool.exact((await itunesSearch(normalize(song.title), country, 'song', 50).catch(() => [])).map(appleSong));
  return byTitle || await findAppleOnWeb(song, country, pool) || await findAppleByListenbrainz(song, country, pool) || pool.closest();
}

// Apple Music's search page, which iTunes rate limits do not reach: songs named like the source, each confirmed
// with the length on its own page.
async function findAppleOnWeb(song, country, pool) {
  for (const phrase of queries(song)) {
    const named = (await appleWebSearch(phrase, country).catch(() => []))
      .filter(candidate => asVariants(song).some(variant => sameTrackTitle(variant.title, candidate.title)))
      .slice(0, 4);
    if (!named.length) continue;
    const pages = (await Promise.all(named.map(candidate => applePageSong(candidate.id, country)
      .then(page => page && { ...page, artist: candidate.artist, url: candidate.url }).catch(() => null)))).filter(Boolean);
    const found = pool.exact(pages);
    if (found) return found;
  }
  return null;
}

// ListenBrainz's Apple Music ids, confirmed through iTunes lookup or, when iTunes is rate-limited, Apple's song page.
async function findAppleByListenbrainz(song, country, pool) {
  const ids = await listenbrainzIds('apple', song).catch(() => []);
  if (!ids.length) return null;
  let candidates = await itunesLookup(ids, country).then(results => results.filter(r => r.wrapperType === 'track').map(appleSong)).catch(() => null);
  candidates ||= (await Promise.all(ids.map(id => applePageSong(id, country).catch(() => null)))).filter(Boolean);
  return pool.exact(candidates);
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
  const candidates = (await itunesSearch(normalize(song.title), country, 'song', 30))
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
    const track = await fetchJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(song.isrc)}`, { retry: true }).catch(() => null);
    const agrees = track?.id && !track.error && track.isrc?.toUpperCase() === song.isrc.toUpperCase() &&
      (sameTrackTitle(song.title, track.title) || artistsOverlap(song.artist, track.artist?.name));
    if (agrees) return deezerSong(track);
  }
  const pool = matcher(song);
  const search = async q => ((await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`, { retry: true }).catch(() => ({}))).data || []).map(deezerSong);
  for (const phrase of queries(song)) {
    const found = pool.exact(await search(phrase));
    if (found) return found;
  }
  // The title alone finds songs whose artist Deezer spells differently (another script, "Fairouz" for "Fairuz").
  return pool.exact(await search(normalize(song.title))) || pool.closest();
}

// Spotify Web API when credentials exist; otherwise (or when it finds nothing) ListenBrainz ids checked via embed pages,
// once for each of the song's names.
async function findSpotify(song) {
  const pool = matcher(song);
  const viaApi = pool.exact(await searchSpotify(song).catch(() => []));
  if (viaApi) return viaApi;
  for (const variant of asVariants(song).slice(0, 2)) {
    const found = pool.exact(await searchSpotifyKeyless(variant).catch(() => []));
    if (found) return found;
  }
  // The artist's top tracks, then the album's tracks, on Spotify's public embed pages.
  const catalog = await spotifyCatalogTracks(song).catch(() => null);
  const fromTop = catalog && pool.exact(catalog.top);
  if (fromTop) return fromTop;
  const fromAlbum = catalog && pool.exact(await catalog.albumTracks().catch(() => []));
  return fromAlbum || pool.closest();
}
const asTarget = (platform, candidates) => candidates.map(candidate => ({ ...candidate, url: youtubeUrl(platform, candidate.videoId) }));

const ofKind = (uploads, kind) => uploads.filter(video => video.official === kind);

// YouTube Music: the song itself — its "Songs" search, then the auto-generated Topic upload,
// then an official upload of the audio, then the official video.
async function findYoutubeMusic(song, country, videos) {
  const pool = matcher(song);
  for (const phrase of queries(song)) {
    const fromMusic = pool.exact(await searchYoutubeMusic(phrase, country).catch(() => []));
    if (fromMusic) return fromMusic;
  }
  const uploads = asTarget('youtubeMusic', await videos());
  pool.see(uploads);
  return pickCandidate(song, ofKind(uploads, 'topic')) || pickCandidate(song, uploads) ||
    closestOfficialVideo(song, ofKind(uploads, 'artist')) || closestOfficialVideo(song, ofKind(uploads, 'label')) || pool.closest();
}

// YouTube: the artist's own music video first, then the Topic upload, then the label's upload.
async function findYoutube(song, country, videos) {
  const uploads = asTarget('youtube', await videos());
  const pool = matcher(song);
  pool.see(uploads);
  return closestOfficialVideo(song, ofKind(uploads, 'artist')) || pickCandidate(song, ofKind(uploads, 'topic')) ||
    closestOfficialVideo(song, ofKind(uploads, 'label')) || pickCandidate(song, uploads) || pool.closest();
}

// An official music video of the same song can run longer than the track (intro, outro): up to 90 s on the
// artist's own channel, 20 s on label channels, which also carry live and TV recordings.
function closestOfficialVideo(song, videos) {
  if (!song.duration) return null;
  return videos
    .filter(video => variantsOf(song).some(title => sameTrackTitle(title, video.title)) && artistsOverlap(song.artist, video.artist) && video.duration &&
      Math.abs(video.duration - song.duration) <= (video.official === 'label' ? 20_000 : 90_000))
    .sort((a, b) => Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration))[0] || null;
}
// SoundCloud is full of re-uploads: accept label-distributed tracks and the artist's own account only.
const ownAccount = (song, uploader) => compactName(primary(song.artist)).length >= 3 && compactName(uploader).includes(compactName(primary(song.artist)));
async function findSoundcloud(song) {
  const pool = matcher(song);
  for (const phrase of queries(song)) {
    const results = await searchSoundcloud(phrase);
    const found = pool.exact(results.filter(track => track.distributed || ownAccount(song, track.uploader)));
    if (found) return found;
    // No official upload: one SoundCloud recognised as this artist's recording may still be offered as the closest.
    pool.see(results.filter(track => track.recognised && !track.distributed && artistsOverlap(song.artist, track.artist)));
  }
  return pool.closest();
}

const acceptsTrackUrl = url => { try { parseMusicUrl(url); return true; } catch { return false; } };

// Someone else's upload: find the release it contains from the words of its title, so the other platforms are
// searched for that song by its real artist and name. The same recording counts as exact; a remix, live take
// or excerpt of it makes every match the closest result. Returns that closest score, or 0.
async function identify(song, country, record, { official = false } = {}) {
  const known = await identifyUpload({ title: song.rawTitle, channel: song.channel, duration: song.duration, official }, country).catch(() => null);
  if (!known && official) return null;
  if (!known) {
    // Unknown song: search with the title's own words, never with the uploader's channel name.
    const words = uploadSearches(song.rawTitle);
    const split = splitArtistTitle(String(song.rawTitle).replace(/\s*[([{【].*?[)\]}】]/g, '').replace(/#\S+/g, '').trim());
    Object.assign(song, split ? { artist: split.artist, title: split.title } : { artist: '', title: words[1] || words[0] || song.title }, { titleVariants: [] });
    return 0;
  }
  const video = { displayArtwork: song.artwork, displayDuration: song.duration };
  Object.assign(song, known.song, { durationReliable: true, titleVariants: [], unofficial: false, identified: true });
  const platform = /deezer\.com/.test(known.song.url) ? 'deezer' : 'apple';
  if (!known.altered) { record(platform, known.song); return 0; }
  // Matched as the original song, shown as the upload it is ("Başa Bela (Vedat Unal Remix)", its own picture and length).
  Object.assign(song, video, { displayTitle: known.label ? `${known.song.title} (${known.label})` : known.song.title });
  record(platform, { ...known.song, close: true, score: 0.9 });
  return 0.9;
}

// Every platform's search for the song; a catalog release found on the way corrects a video's name and length.
async function searchPlatforms(song, country, exact, record) {
  if (!song.artist) return;
  const guessedDuration = !song.durationReliable;
  // Two phrasings: uploads are usually titled "Artist - Title", Topic uploads just "Title".
  let videoSearch;
  const videos = () => (videoSearch ||= Promise.all([
    searchYoutubeVideos(`${primary(song.artist)} - ${song.title}`, country).catch(() => []),
    searchYoutubeVideos(query(song), country).catch(() => [])
  ]).then(([first, second]) => [...first, ...second].filter((video, i, all) => all.findIndex(v => v.videoId === video.videoId) === i)));
  const searches = {
    apple: () => findApple(song, country), deezer: () => findDeezer(song), spotify: () => findSpotify(song),
    youtubeMusic: () => findYoutubeMusic(song, country, videos), youtube: () => findYoutube(song, country, videos),
    soundcloud: () => findSoundcloud(song)
  };
  const tasks = Object.entries(searches).filter(([platform]) => !exact[platform]);
  const results = await Promise.allSettled(tasks.map(([, find]) => find()));
  const found = {};
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled' || !result.value?.url) return;
    found[tasks[i][0]] = result.value;
    record(tasks[i][0], result.value);
  });
  // A catalog release is a better source of name, album, duration and ISRC than a video page;
  // an exact catalog match is preferred, a closest one is used only to look further.
  const catalog = ['apple', 'deezer', 'spotify'].map(platform => found[platform]).filter(Boolean);
  const reference = catalog.find(match => !match.close) || catalog[0];
  if (reference) {
    song.album ||= reference.album;
    if (!song.durationReliable && reference.title) {
      song.titleVariants = [...new Set([reference.title, ...song.titleVariants])];
      song.title = reference.title;
    }
    if (!song.duration || !song.durationReliable) Object.assign(song, { duration: reference.duration || song.duration, durationReliable: true });
  }
  if (!reference?.close) song.isrc ||= found.deezer?.isrc || found.spotify?.isrc || found.soundcloud?.isrc || null;
  // A video's length is only a hint; once a catalog supplied the real duration and name, retry the
  // platforms that were not matched exactly. Results built on a closest match stay "closest".
  if (guessedDuration && song.durationReliable) {
    const retry = tasks.filter(([platform]) => !exact[platform]);
    const again = await Promise.allSettled(retry.map(([platform]) => searches[platform]()));
    again.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value?.url) return;
      record(retry[i][0], reference.close ? { ...result.value, close: true, score: result.value.score || reference.score } : result.value);
    });
  }
}

export async function resolveMusicUrl(rawUrl, country = 'us') {
  const source = isShortMusicLink(rawUrl) ? await followRedirects(String(rawUrl).trim(), acceptsTrackUrl) : rawUrl;
  const input = parseMusicUrl(source);
  if (input.kind === 'album') return resolveAlbum(input, country);
  const song = { durationReliable: true, ...await sourceMetadata(input) };
  const exact = { [input.platform]: input.url };
  // Closest (not exact) results per platform: { url, title, artist, score }.
  const close = {};
  // Set when the input is another version of a catalog song (a remix or live upload): every match is then only the closest.
  let closeOnly = 0;
  const record = (platform, match) => {
    if (!match?.url || exact[platform]) return;
    if (closeOnly) match = { ...match, close: true, score: Math.min(match.score || 1, closeOnly) };
    if (match.close) { if (!close[platform] || close[platform].score < match.score) close[platform] = { url: match.url, title: match.title, artist: match.artist, score: match.score }; }
    else { exact[platform] = match.url; delete close[platform]; }
  };
  const add = links => { for (const [platform, url] of Object.entries(links || {})) record(platform, { url, title: song.title, artist: song.artist }); };

  if (song.unofficial) closeOnly = await identify(song, country, record);

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

  // Long or annotated names ("Song | Official Video | …", "Song - 2011 Remaster") are also searched in their plain forms.
  song.titleVariants = [...new Set([...(song.titleVariants || []), ...titleVariants(song.title, song.artist)])];

  const knownIsrc = song.isrc;
  await searchPlatforms(song, country, exact, record);
  // A video titled its own way ("BTS (방탄소년단) 'Dynamite' @ America's Got Talent") that no catalog recognised:
  // identify the song from the words of its title, as for someone else's upload, and search again.
  if (song.rawTitle && !song.identified && !['apple', 'deezer', 'spotify'].some(platform => exact[platform] || close[platform])) {
    const level = await identify(song, country, record, { official: true });
    if (level !== null) {
      closeOnly = level;
      song.titleVariants = titleVariants(song.title, song.artist);
      await searchPlatforms(song, country, exact, record);
    }
  }

  if (song.isrc && PLATFORMS.some(platform => !exact[platform.id])) {
    const fromIsrc = await lookupIsrcRecording(song.isrc, song, country).catch(() => null);
    add(fromIsrc?.links);
  }
  // The catalog searches above ran without this ISRC; retry the ISRC-capable catalogs once.
  if (song.isrc && song.isrc !== knownIsrc) {
    if (!exact.deezer) record('deezer', await findDeezer(song).catch(() => null));
    if (!exact.spotify) record('spotify', await findSpotify(song).catch(() => null));
  }
  for (const platform of Object.keys(close)) if (exact[platform]) delete close[platform];

  // The same video id plays on both YouTube sites, so a match on one is a link of the same kind for the other.
  for (const [from, to] of [['youtubeMusic', 'youtube'], ['youtube', 'youtubeMusic']]) {
    const id = exact[from] && new URL(exact[from]).searchParams.get('v');
    if (id && !exact[to]) { exact[to] = youtubeUrl(to, id); delete close[to]; }
    const closeId = !exact[to] && !close[to] && close[from] && new URL(close[from].url).searchParams.get('v');
    if (closeId) close[to] = { ...close[from], url: youtubeUrl(to, closeId) };
  }

  const links = searchLinks(song.title, song.artist);
  return {
    kind: 'track',
    song: { title: song.displayTitle || song.title, artist: song.artist, album: song.album, artwork: song.displayArtwork || song.artwork, duration: song.displayDuration || song.duration },
    sourcePlatform: input.platform,
    platforms: PLATFORMS.map(platform => {
      if (exact[platform.id]) return { ...platform, url: exact[platform.id], exact: true, match: 'exact' };
      const nearest = close[platform.id];
      if (nearest) return { ...platform, url: nearest.url, exact: false, match: 'close', matchTitle: nearest.title, matchArtist: nearest.artist, score: Math.round(nearest.score * 100) / 100 };
      return { ...platform, url: links[platform.id], exact: false, match: 'search' };
    })
  };
}
