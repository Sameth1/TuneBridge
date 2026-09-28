import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicUrl, confidentMatch, searchLinks } from './lib.js';

test('Apple Music album links use the song id in i=', () => {
  const parsed = parseMusicUrl('https://music.apple.com/tr/album/example/123456?i=987654');
  assert.equal(parsed.platform, 'apple');
  assert.equal(parsed.id, '987654');
});

test('recognises album links and rejects unsupported hosts', () => {
  assert.deepEqual(parseMusicUrl('https://music.apple.com/tr/album/example/123456'), { platform: 'apple', kind: 'album', id: '123456', url: 'https://music.apple.com/tr/album/123456' });
  assert.equal(parseMusicUrl('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc?si=x').kind, 'album');
  assert.equal(parseMusicUrl('https://www.deezer.com/tr/album/302127').url, 'https://www.deezer.com/album/302127');
  assert.equal(parseMusicUrl('https://music.youtube.com/playlist?list=OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw').kind, 'album');
  assert.throws(() => parseMusicUrl('https://www.youtube.com/playlist?list=PL1234567890'));
  assert.throws(() => parseMusicUrl('https://example.com/music.apple.com/tr/song/123456'));
});

test('matches a transliterated artist only with close title and duration', () => {
  const source = { title: 'Nassam Alayna El Hawa', artist: 'Fairouz', duration: 237192 };
  assert.equal(confidentMatch(source, { title: 'Nassam Alayna El Hawa', artist: 'Fairuz', duration: 237000 }), true);
  assert.equal(confidentMatch(source, { title: 'Nassam Alayna El Hawa', artist: 'Fairuz', duration: 270000 }), false);
  assert.equal(confidentMatch(source, { title: 'Nassam Alayna El Hawa', artist: 'Another Artist', duration: 237000 }), false);
});

test('does not confuse a live recording with the studio version', () => {
  const source = { title: 'Get Lucky (Live)', artist: 'Daft Punk', duration: 369000 };
  assert.equal(confidentMatch(source, { title: 'Get Lucky', artist: 'Daft Punk', duration: 369000 }), false);
  assert.equal(confidentMatch({ ...source, title: 'Get Lucky (Canlı)' }, { title: 'Get Lucky', artist: 'Daft Punk', duration: 369000 }), false);
});

test('search links preserve non-Latin song names', () => {
  const links = searchLinks('أغنية', 'فنان');
  assert.equal(new URL(links.youtubeMusic).searchParams.get('q'), 'أغنية فنان');
  assert.equal(new URL(links.youtube).searchParams.get('search_query'), 'أغنية فنان');
});
