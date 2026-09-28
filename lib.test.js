import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicUrl, confidentMatch, searchLinks } from './lib.js';

test('Apple Music album links use the song id in i=', () => {
  const parsed = parseMusicUrl('https://music.apple.com/tr/album/example/123456?i=987654');
  assert.equal(parsed.platform, 'apple');
  assert.equal(parsed.id, '987654');
});

test('rejects unsupported and album links', () => {
  assert.throws(() => parseMusicUrl('https://music.apple.com/tr/album/example/123456'));
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
