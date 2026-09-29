import test from 'node:test';
import assert from 'node:assert/strict';
import { albumMatch, sameAlbumTitle } from './lib.js';
import { parseAlbumEmbed } from './spotify.js';
import { albumOfSong } from './youtube.js';
import { extractAlbumLinks } from './musicbrainz.js';
import { parseApplePage } from './apple.js';
import { resolveMusicUrl } from './resolve.js';

function mockFetch(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const href = String(url);
    calls.push(href);
    for (const [pattern, body] of routes) {
      if (!href.includes(pattern)) continue;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const nextData = entity => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;

test('albums match on title, edition, artist and track count, or on a shared UPC', () => {
  const discovery = { title: 'Discovery', artist: 'Daft Punk', trackCount: 14, year: '2001' };
  assert.equal(albumMatch(discovery, { title: 'Discovery', artist: 'Daft Punk', trackCount: 14 }), true);
  assert.equal(albumMatch(discovery, { title: 'Discovery (Deluxe Edition)', artist: 'Daft Punk', trackCount: 14 }), false);
  assert.equal(albumMatch(discovery, { title: 'Discovery', artist: 'Daft Punk', trackCount: 22 }), false);
  assert.equal(albumMatch(discovery, { title: 'Discovery', artist: 'Daft Punk', trackCount: 15, year: '2001' }), true);
  assert.equal(albumMatch({ ...discovery, upc: '0724384960650' }, { title: 'Other', artist: 'Other', upc: '724384960650' }), true);
  assert.equal(sameAlbumTitle('Blinding Lights - Single', 'Blinding Lights'), true);
  assert.equal(sameAlbumTitle('After Hours (Deluxe)', 'After Hours'), false);
});

test('reads a Spotify album embed page and a YouTube Music album reference', () => {
  const album = parseAlbumEmbed(nextData({ type: 'album', uri: 'spotify:album:x', name: 'After Hours', subtitle: 'The Weeknd', releaseDate: { isoString: '2020-03-20T00:00:00Z' },
    trackList: [{ title: 'Alone Again', subtitle: 'The Weeknd', duration: 250053 }, { title: 'Too Late', subtitle: 'The Weeknd', duration: 239973 }] }));
  assert.deepEqual([album.title, album.artist, album.trackCount, album.year, album.tracks[0].title], ['After Hours', 'The Weeknd', 2, '2020', 'Alone Again']);
  const next = { contents: { runs: [{ text: 'The Weeknd' }, { text: ' • ' }, { text: 'Blinding Lights', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_4U7yfKKFZLv' } } }] } };
  assert.deepEqual(albumOfSong(next), { title: 'Blinding Lights', url: 'https://music.youtube.com/browse/MPREb_4U7yfKKFZLv' });
});

test('turns MusicBrainz release relations into album links for the visitor storefront', () => {
  const links = extractAlbumLinks({ relations: [
    { url: { resource: 'https://music.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw' } },
    { url: { resource: 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc' } },
    { url: { resource: 'https://itunes.apple.com/gb/album/id697194953' } },
    { url: { resource: 'https://open.spotify.com/track/2noRn2Aes5aoNVsU6iWThc' } }
  ] }, 'tr');
  assert.deepEqual(links, {
    youtubeMusic: 'https://music.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw',
    youtube: 'https://www.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw',
    spotify: 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc',
    apple: 'https://music.apple.com/tr/album/697194953'
  });
});

test('reads Apple\'s public song page', () => {
  const html = '<meta property="og:title" content="Stand by Me by Ben E. King on Apple Music"><meta property="music:song:duration" content="PT2M58S">';
  assert.deepEqual(parseApplePage(html, 'https://music.apple.com/us/song/1'), { title: 'Stand by Me', artist: 'Ben E. King', album: '', duration: 178000, isrc: null, url: 'https://music.apple.com/us/song/1' });
});

test('a Deezer album resolves through its UPC, MusicBrainz and iTunes', async () => {
  const mock = mockFetch([
    ['api.deezer.com/album/302127', { id: 302127, title: 'Discovery', artist: { name: 'Daft Punk' }, upc: '724384960650', nb_tracks: 14, release_date: '2001-03-07', tracks: { data: [{ title: 'One More Time', artist: { name: 'Daft Punk' }, duration: 320 }] } }],
    ['musicbrainz.org/ws/2/release?query=barcode:724384960650', { releases: [{ id: 'rel-1', barcode: '724384960650' }] }],
    ['musicbrainz.org/ws/2/release/rel-1', { relations: [
      { url: { resource: 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc' } },
      { url: { resource: 'https://music.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw' } }
    ] }],
    ['itunes.apple.com/search', { results: [
      { wrapperType: 'collection', collectionId: 1, collectionName: 'Discovery (Deluxe)', artistName: 'Daft Punk', trackCount: 14 },
      { wrapperType: 'collection', collectionId: 697194953, collectionName: 'Discovery', artistName: 'Daft Punk', trackCount: 14, releaseDate: '2001-03-12T08:00:00Z' }
    ] }]
  ]);
  try {
    const result = await resolveMusicUrl('https://www.deezer.com/album/302127', 'tr');
    const byId = Object.fromEntries(result.platforms.map(p => [p.id, p]));
    assert.equal(result.kind, 'album');
    assert.deepEqual([result.song.title, result.song.trackCount, result.song.year], ['Discovery', 14, '2001']);
    assert.equal(byId.spotify.url, 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc');
    assert.equal(byId.youtube.url, 'https://www.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw');
    assert.equal(byId.apple.url, 'https://music.apple.com/tr/album/697194953');
    assert.equal(byId.soundcloud.exact, false);
  } finally { mock.restore(); }
});

test('without Spotify credentials, a song is found through ListenBrainz and checked on its embed page', async () => {
  const mock = mockFetch([
    ['api.deezer.com/track/3518914151', { id: 3518914151, title: 'Gidiyorum', artist: { name: 'Sezen Aksu' }, album: { title: 'Sezen Aksu Söylüyor' }, duration: 289, isrc: null, link: 'https://www.deezer.com/track/3518914151' }],
    ['labs.api.listenbrainz.org/spotify-id-from-metadata', [{ spotify_track_ids: ['0000000000000000000000', '6c2pU41kfFqdT6eJ9ocQcX'] }]],
    ['open.spotify.com/embed/track/0000000000000000000000', nextData({ uri: 'spotify:track:0000000000000000000000', name: 'Gidiyorum', artists: [{ name: 'Ozan Doğulu' }], duration: 343693 })],
    ['open.spotify.com/embed/track/6c2pU41kfFqdT6eJ9ocQcX', nextData({ uri: 'spotify:track:6c2pU41kfFqdT6eJ9ocQcX', name: 'Gidiyorum', artists: [{ name: 'Sezen Aksu' }], duration: 291173 })]
  ]);
  try {
    const result = await resolveMusicUrl('https://www.deezer.com/track/3518914151', 'tr');
    const spotify = result.platforms.find(p => p.id === 'spotify');
    assert.equal(spotify.url, 'https://open.spotify.com/track/6c2pU41kfFqdT6eJ9ocQcX');
    assert.equal(spotify.exact, true);
  } finally { mock.restore(); }
});
