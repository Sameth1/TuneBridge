import test from 'node:test';
import assert from 'node:assert/strict';
import { spelledMatch } from './lib.js';
import { parseAppleSearch } from './apple.js';
import { parseArtistEmbed } from './spotify.js';
import { soundcloudSong } from './soundcloud.js';

test('a transliterated name of the same recording matches; another word does not', () => {
  const song = { title: 'Tamally Maak', artist: 'Amr Diab', duration: 290000 };
  assert.equal(spelledMatch(song, { title: 'Tamly Maak', artist: 'Amr Diab', duration: 291000 }), true);
  assert.equal(spelledMatch({ title: 'Kifak Inta', artist: 'Fairuz', duration: 300000 }, { title: 'Kifak Inta', artist: 'Fairouz', duration: 300500 }), true);
  assert.equal(spelledMatch(song, { title: 'Tamly Maak', artist: 'Amr Diab', duration: 296000 }), false);
  assert.equal(spelledMatch({ title: 'Seni Sevdim', artist: 'X', duration: 200000 }, { title: 'Beni Sevdin', artist: 'X', duration: 200000 }), false);
  assert.equal(spelledMatch({ title: 'Gidiyorum', artist: 'Sezen Aksu', duration: 289000 }, { title: 'Gidiyorum (Live)', artist: 'Sezen Aksu', duration: 289000 }), false);
});

test('reads songs from the Apple Music search page', () => {
  const data = { data: [{ data: { sections: [{ itemKind: 'trackLockup', items: [{
    title: 'Başa Bela', subtitleLinks: [{ title: 'Ezhel' }],
    contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '6772992188' }, url: 'https://music.apple.com/tr/album/ba%C5%9Fa-bela/6772992184?i=6772992188' }
  }, { title: 'Başa Bela', contentDescriptor: { kind: 'album', url: 'https://music.apple.com/tr/album/x/1' } }] }] } }] };
  const html = `<script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script>`;
  assert.deepEqual(parseAppleSearch(html), [{ id: '6772992188', title: 'Başa Bela', artist: 'Ezhel', url: 'https://music.apple.com/tr/album/ba%C5%9Fa-bela/6772992184?i=6772992188' }]);
});

test('reads an artist’s top tracks from the Spotify embed page', () => {
  const state = { props: { pageProps: { state: { data: { entity: { uri: 'spotify:artist:6LnJKrtFnTEGdbWQ2riWCL', trackList: [
    { uri: 'spotify:track:0onzYPfM09MY31tUkb0xgj', title: 'Başa Bela', subtitle: 'Ezhel', duration: 154081 }
  ] } } } } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`;
  assert.deepEqual(parseArtistEmbed(html), [{ title: 'Başa Bela', artist: 'Ezhel', duration: 154081, isrc: null, url: 'https://open.spotify.com/track/0onzYPfM09MY31tUkb0xgj' }]);
});

test('only releases with an ISRC, UPC or paid streaming count as distributed on SoundCloud', () => {
  const base = { title: 'Simarik', duration: 235000, permalink_url: 'https://soundcloud.com/x/simarik', user: { username: 'radha' } };
  assert.equal(soundcloudSong({ ...base, monetization_model: 'BLACKBOX', publisher_metadata: { artist: 'Tarkan', album_title: 'Olurum Sana' } }).distributed, false);
  assert.equal(soundcloudSong({ ...base, monetization_model: 'AD_SUPPORTED', publisher_metadata: { artist: 'Ezhel', isrc: 'QM7282641742' } }).distributed, true);
});
