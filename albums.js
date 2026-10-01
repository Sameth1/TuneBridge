import { UserError, PLATFORMS, albumMatch, sameAlbumTitle, sameTrackTitle, artistsOverlap, normalize, searchLinks, youtubeAlbumUrl, titleSimilarity } from './lib.js';
import { fetchJson, fetchText } from './http.js';
import { itunesLookup, itunesSearch, appleAlbum, parseApplePage } from './apple.js';
import { spotifyAlbumById, spotifyAlbumIdOfTrack, searchSpotifyKeyless, searchSpotifyAlbums } from './spotify.js';
import { youtubeAlbumMetadata, youtubeMusicAlbumOfVideo, searchYoutubeVideos, searchYoutubeMusic } from './youtube.js';
import { soundcloudAlbumMetadata, searchSoundcloudAlbums } from './soundcloud.js';
import { lookupReleaseByBarcode, spotifyAlbumIds } from './musicbrainz.js';

const primaryArtist = artist => String(artist || '').split(/,|&| feat\.? /i)[0].trim();
const albumQuery = album => `${normalize(String(album.title).replace(/\s[-–—]\s(single|ep)$/i, ''))} ${primaryArtist(album.artist)}`;

function deezerAlbum(album) {
  return {
    title: album.title,
    artist: album.artist?.name || '',
    trackCount: album.nb_tracks || null,
    year: album.release_date?.slice(0, 4) || null,
    upc: album.upc || null,
    artwork: album.cover_xl || null,
    url: `https://www.deezer.com/album/${album.id}`,
    tracks: (album.tracks?.data || []).map(track => ({ title: track.title, artist: track.artist?.name, duration: track.duration ? track.duration * 1000 : null }))
  };
}

async function albumMetadata(input, country) {
  switch (input.platform) {
    case 'apple': {
      const storefront = new URL(input.url).pathname.split('/')[1] || country;
      const results = await itunesLookup([input.id], storefront).catch(() => null);
      const collection = results?.find(result => result.wrapperType === 'collection');
      if (collection) {
        return { ...appleAlbum(collection, storefront), tracks: results.filter(r => r.wrapperType === 'track').map(t => ({ title: t.trackName, artist: t.artistName, duration: t.trackTimeMillis })) };
      }
      // iTunes rate-limited: the album page still names the album and artist.
      const page = parseApplePage(await fetchText(input.url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }).catch(() => ''), input.url);
      if (!page) throw new UserError('album_not_found', 'This album could not be found.');
      return { title: page.title, artist: page.artist, trackCount: null, year: null, upc: null, artwork: null, tracks: [] };
    }
    case 'deezer': {
      const album = await fetchJson(`https://api.deezer.com/album/${input.id}`, { retry: true });
      if (!album.title || album.error) throw new UserError('album_not_found', 'This album could not be found.');
      return deezerAlbum(album);
    }
    case 'spotify': return spotifyAlbumById(input.id);
    case 'youtube':
    case 'youtubeMusic': return youtubeAlbumMetadata(input.id);
    case 'soundcloud': return soundcloudAlbumMetadata(input.url);
  }
}

// Matching albums, the same release year and track count first.
function pickAlbum(album, candidates) {
  const score = candidate => (album.year && candidate.year === album.year ? 0 : 1) + (album.trackCount && candidate.trackCount === album.trackCount ? 0 : 1);
  const exact = candidates.filter(candidate => candidate.url && albumMatch(album, candidate)).sort((a, b) => score(a) - score(b))[0];
  return exact || closestAlbum(album, candidates);
}

// No exact album: the most similar one by the same artist (a differently spelled name, one track more or
// less), returned marked `close`. Different editions (Deluxe, Live…) still never count.
function closestAlbum(album, candidates) {
  const plain = value => String(value || '').replace(/\s[-–—]\s(single|ep)$/i, '');
  const ranked = candidates.filter(candidate => candidate.url && artistsOverlap(album.artist, candidate.artist))
    .map(candidate => {
      const title = titleSimilarity(plain(album.title), plain(candidate.title));
      const tracks = album.trackCount && candidate.trackCount ? Math.max(0, 1 - Math.abs(album.trackCount - candidate.trackCount) / 4) : 0.6;
      const sameEdition = sameAlbumTitle(candidate.title, album.title) || !/deluxe|expanded|special|live|canlı|remix|acoustic|akustik/i.test(`${album.title} ${candidate.title}`);
      return { candidate, score: sameEdition ? title * 0.75 + tracks * 0.25 : 0 };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.8 ? { ...ranked[0].candidate, close: true, score: ranked[0].score } : null;
}

async function findDeezerAlbum(album) {
  if (album.upc) {
    // A UPC names one release exactly.
    const byUpc = await fetchJson(`https://api.deezer.com/album/upc:${album.upc}`, { retry: true }).catch(() => null);
    if (byUpc?.id && !byUpc.error) return deezerAlbum(byUpc);
  }
  const data = await fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(albumQuery(album))}&limit=15`, { retry: true });
  const match = pickAlbum(album, (data.data || []).map(item => ({
    id: item.id, title: item.title, artist: item.artist?.name, trackCount: item.nb_tracks || null, year: null, upc: null, url: `https://www.deezer.com/album/${item.id}`
  })));
  if (!match) return null;
  // The full album record carries the UPC, year and track list the other platforms are checked against.
  const full = await fetchJson(`https://api.deezer.com/album/${match.id}`, { retry: true }).catch(() => null);
  return full?.id ? { ...deezerAlbum(full), close: match.close, score: match.score } : match;
}

async function findAppleAlbum(album, country) {
  return pickAlbum(album, (await itunesSearch(albumQuery(album), country, 'album', 25)).map(item => appleAlbum(item, country)));
}

const trackSong = (album, track) => ({ title: track.title, artist: track.artist || album.artist, duration: track.duration || null });

// Without API credentials: find the album's first tracks on Spotify, read the album each belongs to, and check it.
async function findSpotifyAlbum(album) {
  const viaApi = pickAlbum(album, await searchSpotifyAlbums(album).catch(() => []));
  if (viaApi) return viaApi;
  // The Spotify album MusicBrainz links to a release of this name.
  for (const id of await spotifyAlbumIds(String(album.title).replace(/\s[-–—]\s(single|ep)$/i, ''), primaryArtist(album.artist)).catch(() => [])) {
    const found = await spotifyAlbumById(id).catch(() => null);
    if (found && albumMatch(album, found)) return found;
  }
  const seen = new Set();
  for (const track of album.tracks.slice(0, 2)) {
    const song = trackSong(album, track);
    const tracks = (await searchSpotifyKeyless(song).catch(() => []))
      .filter(candidate => sameTrackTitle(song.title, candidate.title) && artistsOverlap(song.artist, candidate.artist));
    for (const candidate of tracks.slice(0, 3)) {
      const albumId = await spotifyAlbumIdOfTrack(candidate.url.split('/').pop()).catch(() => null);
      if (!albumId || seen.has(albumId)) continue;
      seen.add(albumId);
      const found = await spotifyAlbumById(albumId).catch(() => null);
      if (found && albumMatch(album, found)) return found;
    }
  }
  return null;
}

// YouTube Music: an album track's own upload names its album page; keep it only if the album title agrees.
async function findYoutubeMusicAlbum(album, country) {
  for (const track of album.tracks.slice(0, 2)) {
    const song = trackSong(album, track);
    const query = `${normalize(song.title)} ${primaryArtist(song.artist)}`;
    const [songs, videos] = await Promise.all([
      searchYoutubeMusic(query, country).catch(() => []),
      searchYoutubeVideos(query, country).catch(() => [])
    ]);
    const uploads = [...songs, ...videos.sort((a, b) => Number(b.topic) - Number(a.topic))]
      .filter(video => sameTrackTitle(song.title, video.title) && artistsOverlap(song.artist, video.artist));
    for (const video of uploads.slice(0, 3)) {
      const found = await youtubeMusicAlbumOfVideo(video.videoId).catch(() => null);
      if (found && sameAlbumTitle(album.title, found.title)) return found;
    }
  }
  return null;
}

const findSoundcloudAlbum = async album => pickAlbum(album, await searchSoundcloudAlbums(albumQuery(album)));

export async function resolveAlbum(input, country = 'us') {
  const album = await albumMetadata(input, country);
  if (!album?.title) throw new UserError('album_not_found', 'This album could not be found.');
  album.tracks ||= [];
  const exact = { [input.platform]: input.url };
  // An OLAK5uy_ album playlist plays on both YouTube sites.
  if (input.platform === 'youtube' || input.platform === 'youtubeMusic') {
    exact.youtube = youtubeAlbumUrl('youtube', input.id);
    exact.youtubeMusic = youtubeAlbumUrl('youtubeMusic', input.id);
  }
  const add = links => { for (const [platform, url] of Object.entries(links || {})) exact[platform] ||= url; };
  const close = {};

  // Deezer first: its album record supplies the UPC, which makes MusicBrainz and Deezer lookups exact.
  if (!exact.deezer) {
    const deezer = await findDeezerAlbum(album).catch(() => null);
    // Only an exact Deezer album may lend its UPC: a closest one could be another release.
    if (deezer?.close) close.deezer = deezer;
    else if (deezer) {
      exact.deezer = deezer.url;
      Object.assign(album, { upc: album.upc || deezer.upc, trackCount: album.trackCount || deezer.trackCount, year: album.year || deezer.year, artwork: album.artwork || deezer.artwork });
      if (!album.tracks.length) album.tracks = deezer.tracks;
    }
  }
  if (album.upc) add(await lookupReleaseByBarcode(album.upc, country).catch(() => ({})));

  const searches = {
    apple: () => findAppleAlbum(album, country),
    spotify: () => findSpotifyAlbum(album),
    youtubeMusic: () => findYoutubeMusicAlbum(album, country),
    soundcloud: () => findSoundcloudAlbum(album)
  };
  const tasks = Object.entries(searches).filter(([platform]) => !exact[platform] && !close[platform]);
  const results = await Promise.allSettled(tasks.map(([, find]) => find()));
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled' || !result.value?.url) return;
    if (result.value.close) close[tasks[i][0]] = result.value;
    else exact[tasks[i][0]] ||= result.value.url;
  });

  const links = searchLinks(album.title, album.artist);
  return {
    kind: 'album',
    song: { title: album.title, artist: album.artist, album: null, artwork: album.artwork, duration: null, trackCount: album.trackCount, year: album.year },
    sourcePlatform: input.platform,
    platforms: PLATFORMS.map(platform => {
      if (exact[platform.id]) return { ...platform, url: exact[platform.id], exact: true, match: 'exact' };
      const nearest = close[platform.id];
      if (nearest) return { ...platform, url: nearest.url, exact: false, match: 'close', matchTitle: nearest.title, matchArtist: nearest.artist, score: Math.round(nearest.score * 100) / 100 };
      return { ...platform, url: links[platform.id], exact: false, match: 'search' };
    })
  };
}
