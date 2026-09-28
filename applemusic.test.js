import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { developerToken, appleMusicSong } from './applemusic.js';
import { resolveMusicUrl } from './resolve.js';

test('signs an ES256 developer token that verifies with the MusicKit key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const token = developerToken('TEAM123456', 'KEY1234567', privateKey.export({ type: 'pkcs8', format: 'pem' }), 1_700_000_000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: 'TEAM123456', iat: 1_700_000_000, exp: 1_700_043_200 });
  assert.equal(crypto.verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
});

test('with Apple Music API credentials, Apple is found by ISRC without iTunes search', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const env = { APPLE_MUSIC_TEAM_ID: 'TEAM123456', APPLE_MUSIC_KEY_ID: 'KEY1234567', APPLE_MUSIC_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n') };
  Object.assign(process.env, env);
  const original = globalThis.fetch;
  const calls = [];
  const song = { attributes: { name: 'Gidiyorum', artistName: 'Sezen Aksu', albumName: 'Sezen Aksu Söylüyor', durationInMillis: 289760, isrc: 'TRA000000001', url: 'https://music.apple.com/tr/album/gidiyorum/1?i=2' } };
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('api.deezer.com/track/777')) return new Response(JSON.stringify({ id: 777, title: 'Gidiyorum', artist: { name: 'Sezen Aksu' }, album: { title: 'x' }, duration: 289, isrc: 'TRA000000001', link: 'https://www.deezer.com/track/777' }));
    if (href.includes('api.music.apple.com/v1/catalog/tr/songs?filter[isrc]=TRA000000001')) {
      assert.match(options.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      return new Response(JSON.stringify({ data: [song] }));
    }
    return new Response('', { status: 503 });
  };
  try {
    const result = await resolveMusicUrl('https://www.deezer.com/track/777', 'tr');
    const apple = result.platforms.find(p => p.id === 'apple');
    assert.equal(apple.url, 'https://music.apple.com/tr/album/gidiyorum/1?i=2');
    assert.equal(apple.exact, true);
    assert.ok(!calls.some(url => url.includes('itunes.apple.com')));
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(env)) delete process.env[key];
  }
});

test('reads Apple Music API song attributes', () => {
  const song = appleMusicSong({ attributes: { name: 'A', artistName: 'B', albumName: 'C', durationInMillis: 1000, isrc: 'X', url: 'https://music.apple.com/us/album/a/1?i=2&at=aff', artwork: { url: 'https://is1-ssl.mzstatic.com/{w}x{h}bb.jpg' } } });
  assert.equal(song.url, 'https://music.apple.com/us/album/a/1?i=2');
  assert.equal(song.artwork, 'https://is1-ssl.mzstatic.com/600x600bb.jpg');
});
