import test from 'node:test';
import assert from 'node:assert/strict';
import { titleVariants, titleSimilarity, matchScore, selectClosest } from './lib.js';
import { songFromMusicNext } from './youtube.js';
import { resolveMusicUrl } from './resolve.js';

test('finds the song names inside long video titles', () => {
  assert.deepEqual(titleVariants('Nour El Ein | Official Music Video - HD Version | عمرو دياب - نور العين', 'Amr Diab'),
    ['Nour El Ein', 'نور العين', 'عمرو دياب - نور العين']);
  assert.deepEqual(titleVariants('Tarkan - Şımarık (Official Video)', 'Tarkan'), ['Şımarık']);
  assert.deepEqual(titleVariants('Gülpembe HD Klip', 'Barış Manço'), ['Gülpembe']);
  assert.deepEqual(titleVariants('Official Music Video'), ['Official Music Video']);
});

test('scores spelling differences high and other songs, versions or artists low', () => {
  const source = { title: 'Nour El Ein', titleVariants: ['Nour El Ein', 'نور العين'], artist: 'Amr Diab', duration: 407000, durationReliable: false };
  assert.ok(titleSimilarity('Nour El Ein', 'Nour El Ain') > 0.85);
  assert.ok(matchScore(source, { title: 'Nour El Ain', artist: 'Amr Diab', duration: 305000 }).score > 0.85);
  assert.equal(matchScore(source, { title: 'Nour El Ain (Live)', artist: 'Amr Diab' }).title, 0);
  assert.equal(selectClosest(source, [{ title: 'Nour El Ain', artist: 'A Cover Band', url: 'x' }]), null);
  assert.equal(selectClosest(source, [{ title: 'Tamally Maak', artist: 'Amr Diab', url: 'y' }]), null);
  assert.equal(selectClosest(source, [{ title: 'Nour El Ain', artist: 'Amr Diab', url: 'z' }]).candidate.url, 'z');
});

test('reads the song name, artist and length YouTube Music gives a video', () => {
  const artistRun = { text: 'Amr Diab', navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } };
  const response = { contents: [{ playlistPanelVideoRenderer: {
    videoId: 'KLJA-srM_yM', title: { runs: [{ text: 'Nour El Ain' }] }, lengthText: { runs: [{ text: '6:47' }] },
    longBylineText: { runs: [artistRun, { text: ' • 195M views' }] },
    navigationEndpoint: { watchEndpoint: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' } } } }
  } }] };
  assert.deepEqual(songFromMusicNext(response, 'KLJA-srM_yM'), { title: 'Nour El Ain', artist: 'Amr Diab', album: '', duration: 407000, artwork: null, durationReliable: false, unofficial: false });
});

test('a platform whose name differs gets a labelled closest match instead of a search link', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const href = String(url);
    const json = body => new Response(JSON.stringify(body));
    if (href.includes('api.deezer.com/track/9')) return json({ id: 9, title: 'Nassam Alayna El Hawa', artist: { name: 'Fairuz' }, album: { title: 'x' }, duration: 237, isrc: null, link: 'https://www.deezer.com/track/9' });
    if (href.includes('itunes.apple.com/search')) return json({ results: [
      { wrapperType: 'track', trackName: 'Nassam Alayna El Hawa', artistName: 'Fairouz', trackTimeMillis: 250000, collectionName: 'y', trackViewUrl: 'https://music.apple.com/tr/album/y/1?i=2' },
      { wrapperType: 'track', trackName: 'Nassam Alayna El Hawa', artistName: 'Someone Else', trackTimeMillis: 237000, collectionName: 'z', trackViewUrl: 'https://music.apple.com/tr/album/z/3?i=4' }
    ] });
    return new Response('', { status: 404 });
  };
  try {
    const result = await resolveMusicUrl('https://www.deezer.com/track/9', 'tr');
    const apple = result.platforms.find(p => p.id === 'apple');
    assert.deepEqual([apple.match, apple.exact, apple.url, apple.matchArtist], ['close', false, 'https://music.apple.com/tr/album/y/1?i=2', 'Fairouz']);
    assert.equal(result.platforms.find(p => p.id === 'spotify').match, 'search');
  } finally { globalThis.fetch = original; }
});
