import { UserError, PLATFORMS, parseMusicUrl, isShortMusicLink, confidentMatch, selectUniqueTitleArtist, searchLinks, normalize, sameTrackTitle, sameAlbumTitle, artistsOverlap, compactName, cleanTrackUrl, youtubeUrl } from './lib.js';
import { fetchJson, followRedirects } from './http.js';
import { lookupSpotifyRecording, lookupIsrcRecording } from './musicbrainz.js';
import { artworkSignature, artworkSimilarity, selectArtworkCandidate } from './artwork.js';
import { spotifyMetadata, searchSpotify, searchSpotifyKeyless } from './spotify.js';
import { youtubeMetadata, searchYoutubeMusic, searchYoutubeVideos } from './youtube.js';
import { soundcloudMetadata, searchSoundcloud } from './soundcloud.js';
import { fetchOdesli, odesliLinks } from './odesli.js';
import { appleMusicConfigured, appleMusicSongById, appleMusicByIsrc, searchAppleMusic } from './applemusic.js';
import { itunesSearch, itunesLookup, appleSong, applePageSong } from './apple.js';
import { listenbrainzIds } from './listenbrainz.js';
import { resolveAlbum } from './albums.js';

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

function deezerSong(track) {
  return { title: track.title, artist: track.artist?.name, album: track.album?.title, artwork: track.album?.cover_xl, duration: track.duration * 1000, isrc: track.isrc || null, url: track.link?.replace(/^http:/, 'https:') };
}

const query = song => `${normalize(song.title)} ${song.artist.split(',')[0]}`;

// Strict matches first: same ISRC, then candidates that carry an ISRC (official releases),
// then the release on the source's album (not a later single or compilation), then closest duration.
function rankMatches(song, candidates) {
  const score = candidate => (song.isrc && candidate.isrc === song.isrc ? 0 : candidate.isrc ? 1 : 2);
  const sameAlbum = candidate => (song.album && candidate.album && sameAlbumTitle(song.album, candidate.album) ? 0 : 1);
  return candidates.filter(candidate => candidate.url && confidentMatch(song, candidate)).sort((a, b) =>
    score(a) - score(b) || sameAlbum(a) - sameAlbum(b) ||
    Math.abs((a.duration || 0) - song.duration) - Math.abs((b.duration || 0) - song.duration));
}

function pickCandidate(song, candidates) {
  const strict = rankMatches(song, candidates);
  if (strict.length) return strict[0];
  return song.durationReliable === false || !song.duration ? selectUniqueTitleArtist(song, candidates.filter(c => c.url)) : null;
}

async function findApple(song, country) {
  if (appleMusicConfigured()) {
    const official = await findAppleMusic(song, country).catch(() => null);
    if (official) return official;
  }
  const candidates = (await itunesSearch(query(song), country).catch(() => [])).map(appleSong);
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
  const found = matches[0] || pickCandidate(song, candidates);
  if (found) return found;
  // The title alone finds songs whose artist is spelled differently on Apple (another script, "&" vs ",").
  const byTitle = pickCandidate(song, (await itunesSearch(normalize(song.title), country, 'song', 50).catch(() => [])).map(appleSong));
  return byTitle || findAppleByListenbrainz(song, country);
}

// ListenBrainz's Apple Music ids, confirmed through iTunes lookup or, when iTunes is rate-limited, Apple's song page.
async function findAppleByListenbrainz(song, country) {
  const ids = await listenbrainzIds('apple', song).catch(() => []);
  if (!ids.length) return null;
  let candidates = await itunesLookup(ids, country).then(results => results.filter(r => r.wrapperType === 'track').map(appleSong)).catch(() => null);
  candidates ||= (await Promise.all(ids.map(id => applePageSong(id, country).catch(() => null)))).filter(Boolean);
  return pickCandidate(song, candidates);
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
  const search = async q => ((await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`, { retry: true })).data || []).map(deezerSong);
  const found = pickCandidate(song, await search(query(song)));
  if (found) return found;
  // Deezer's field search is stricter about which words belong to the artist and which to the title.
  return pickCandidate(song, await search(`artist:"${song.artist.split(',')[0]}" track:"${normalize(song.title)}"`));
}

// Spotify Web API when credentials exist; otherwise (or when it finds nothing) ListenBrainz ids checked via embed pages.
async function findSpotify(song) {
  const viaApi = pickCandidate(song, await searchSpotify(song).catch(() => []));
  return viaApi || pickCandidate(song, await searchSpotifyKeyless(song));
}
const asTarget = (platform, candidates) => candidates.map(candidate => ({ ...candidate, url: youtubeUrl(platform, candidate.videoId) }));

const ofKind = (uploads, kind) => uploads.filter(video => video.official === kind);

// YouTube Music: the song itself — its "Songs" search, then the auto-generated Topic upload,
// then an official upload of the audio, then the official video.
async function findYoutubeMusic(song, country, videos) {
  const fromMusic = pickCandidate(song, await searchYoutubeMusic(query(song), country).catch(() => []));
  if (fromMusic) return fromMusic;
  const uploads = asTarget('youtubeMusic', await videos());
  return pickCandidate(song, ofKind(uploads, 'topic')) || pickCandidate(song, uploads) ||
    closestOfficialVideo(song, ofKind(uploads, 'artist')) || closestOfficialVideo(song, ofKind(uploads, 'label'));
}

// YouTube: the artist's own music video first, then the Topic upload, then the label's upload.
async function findYoutube(song, country, videos) {
  const uploads = asTarget('youtube', await videos());
  return closestOfficialVideo(song, ofKind(uploads, 'artist')) || pickCandidate(song, ofKind(uploads, 'topic')) ||
    closestOfficialVideo(song, ofKind(uploads, 'label')) || pickCandidate(song, uploads);
}

// An official music video of the same song can run longer than the track (intro, outro): up to 90 s on the
// artist's own channel, 20 s on label channels, which also carry live and TV recordings.
function closestOfficialVideo(song, videos) {
  if (!song.duration) return null;
  return videos
    .filter(video => sameTrackTitle(song.title, video.title) && artistsOverlap(song.artist, video.artist) && video.duration &&
      Math.abs(video.duration - song.duration) <= (video.official === 'label' ? 20_000 : 90_000))
    .sort((a, b) => Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration))[0] || null;
}
// SoundCloud is full of re-uploads: accept label-distributed tracks and the artist's own account only.
const ownAccount = (song, uploader) => compactName(song.artist.split(',')[0]).length >= 3 && compactName(uploader).includes(compactName(song.artist.split(',')[0]));
const findSoundcloud = async song => pickCandidate(song, (await searchSoundcloud(query(song))).filter(track => track.distributed || ownAccount(song, track.uploader)));

const acceptsTrackUrl = url => { try { parseMusicUrl(url); return true; } catch { return false; } };

export async function resolveMusicUrl(rawUrl, country = 'us') {
  const source = isShortMusicLink(rawUrl) ? await followRedirects(String(rawUrl).trim(), acceptsTrackUrl) : rawUrl;
  const input = parseMusicUrl(source);
  if (input.kind === 'album') return resolveAlbum(input, country);
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
  const guessedDuration = !song.durationReliable;
  if (song.artist) {
    // Two phrasings: uploads are usually titled "Artist - Title", Topic uploads just "Title".
    let videoSearch;
    const videos = () => (videoSearch ||= Promise.all([
      searchYoutubeVideos(`${song.artist.split(',')[0]} - ${song.title}`, country).catch(() => []),
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
    // A video's length is only a hint; once a catalog supplied the real duration, retry the platforms
    // that could not be matched without it.
    if (guessedDuration && song.durationReliable) {
      const retry = tasks.filter(([platform]) => !exact[platform]);
      const again = await Promise.allSettled(retry.map(([platform]) => searches[platform]()));
      again.forEach((result, i) => { if (result.status === 'fulfilled' && result.value?.url) exact[retry[i][0]] ||= result.value.url; });
    }
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
    kind: 'track',
    song: { title: song.title, artist: song.artist, album: song.album, artwork: song.artwork, duration: song.duration },
    sourcePlatform: input.platform,
    platforms: PLATFORMS.map(platform => ({ ...platform, url: exact[platform.id] || links[platform.id], exact: Boolean(exact[platform.id]) }))
  };
}
