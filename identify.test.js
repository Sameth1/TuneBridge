import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadSearches, explains, identifyUpload } from './identify.js';
import { resolveMusicUrl } from './resolve.js';

test('searches an upload title with fewer and fewer of its words', () => {
  assert.deepEqual(uploadSearches('EZHEL BAŞA BELA OFFİCİAL AUDİO'), ['EZHEL BAŞA BELA', 'EZHEL BAŞA', 'BAŞA BELA']);
  assert.deepEqual(uploadSearches('EZHEL-Başa Bela(sözleri lyrics)').slice(0, 1), ['EZHEL Başa Bela']);
  assert.deepEqual(uploadSearches('Ezhel - Başa Bela (Vedat Unal Remix)').slice(0, 3),
    ['Ezhel Başa Bela Vedat Unal Remix', 'Ezhel Başa Bela Vedat Unal', 'Ezhel Başa Bela Vedat']);
  assert.deepEqual(uploadSearches('ZOKTAY & EZHEL - BAŞA BELA | TikTok Mix (Prod.Seyhan Efe Deniz) #manifest').slice(0, 2),
    ['ZOKTAY EZHEL BAŞA BELA Mix', 'ZOKTAY EZHEL BAŞA BELA']);
});

test('a catalog song explains an upload only when the title names both its artist and its name', () => {
  const song = { title: 'Başa Bela', artist: 'Ezhel', duration: 154000 };
  const same = explains({ title: 'EZHEL-Başa Bela(sözleri lyrics)', channel: 'Nora', duration: 155000 }, song);
  assert.equal(same.altered, false);
  assert.equal(explains({ title: 'Ezhel - Başa Bela (Vedat Unal Remix)', channel: 'Vedat Unal', duration: 178000 }, song).altered, true);
  assert.equal(explains({ title: 'Ezhel-Başa Bela(Yeni Şarkı)', channel: 'x', duration: 113000 }, song).altered, true);
  assert.equal(explains({ title: 'Başa Bela - Gökhan Tutum', channel: 'x', duration: 154000 }, song), null);
  assert.equal(explains({ title: 'Ezhel - Margiela', channel: 'x', duration: 154000 }, song), null);
});

function mockCatalog(extra = {}) {
  const json = body => new Response(JSON.stringify(body));
  const track = { id: 7, title: 'Başa Bela', artist: { name: 'Ezhel' }, album: { title: 'Başa Bela', cover_xl: 'https://e-cdns-images.dzcdn.net/c.jpg' }, duration: 154, isrc: 'QM7282641742', link: 'https://www.deezer.com/track/7' };
  return async url => {
    const href = String(url);
    for (const [pattern, body] of Object.entries(extra)) if (href.includes(pattern)) return json(body);
    if (href.includes('api.deezer.com/track/7') || href.includes('api.deezer.com/track/isrc:')) return json(track);
    if (href.includes('api.deezer.com/search')) return json({ data: href.includes('Margiela') ? [] : [{ ...track, isrc: undefined }] });
    return json({});
  };
}

test('identifies the release inside an unofficial upload', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockCatalog();
  try {
    const found = await identifyUpload({ title: 'EZHEL BAŞA BELA OFFİCİAL AUDİO', channel: 'MÜZİK REMİX', duration: 157000 });
    assert.equal(found.altered, false);
    assert.deepEqual([found.song.title, found.song.artist, found.song.isrc], ['Başa Bela', 'Ezhel', 'QM7282641742']);
    const remix = await identifyUpload({ title: 'Ezhel - Başa Bela (Vedat Unal Remix)', channel: 'Vedat Unal', duration: 178000 });
    assert.deepEqual([remix.altered, remix.label], [true, 'Vedat Unal Remix']);
  } finally {
    globalThis.fetch = original;
  }
});

test('a remix upload links every other platform to the original as the closest result, never a raw-title search', async () => {
  const original = globalThis.fetch;
  const ugc = { contents: [{ playlistPanelVideoRenderer: {
    videoId: 'I_kuoxcfXwM', title: { runs: [{ text: 'Ezhel - Başa Bela (Vedat Unal Remix)' }] }, lengthText: { runs: [{ text: '2:58' }] },
    longBylineText: { runs: [{ text: 'Vedat Unal' }, { text: ' • 1M views' }] },
    navigationEndpoint: { watchEndpoint: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_UGC' } } } }
  } }] };
  globalThis.fetch = mockCatalog({ 'music.youtube.com/youtubei/v1/next': ugc, 'youtubei/v1/player': { playabilityStatus: { status: 'LOGIN_REQUIRED' } } });
  try {
    const result = await resolveMusicUrl('https://www.youtube.com/watch?v=I_kuoxcfXwM', 'tr');
    assert.equal(result.song.title, 'Başa Bela (Vedat Unal Remix)');
    assert.equal(result.song.artist, 'Ezhel');
    const deezer = result.platforms.find(platform => platform.id === 'deezer');
    assert.deepEqual([deezer.match, deezer.url, deezer.matchTitle], ['close', 'https://www.deezer.com/track/7', 'Başa Bela']);
    assert.equal(result.platforms.find(platform => platform.id === 'youtube').match, 'exact');
    for (const platform of result.platforms.filter(p => p.match === 'search')) {
      assert.ok(!/Vedat|Remix/i.test(decodeURIComponent(platform.url)), platform.url);
    }
  } finally {
    globalThis.fetch = original;
  }
});
