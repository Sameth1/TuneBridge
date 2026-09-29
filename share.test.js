import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedLink } from './public/share.js';

test('finds the music link in what a phone app shares', () => {
  assert.equal(sharedLink(new URLSearchParams({ text: 'Listen to Divane by Yaşar on Spotify https://open.spotify.com/track/3V9Cf4pENsRh02WTMJ726n?si=abc' })), 'https://open.spotify.com/track/3V9Cf4pENsRh02WTMJ726n');
  assert.equal(sharedLink(new URLSearchParams({ title: 'Divane', url: 'https://music.apple.com/tr/song/594786564' })), 'https://music.apple.com/tr/song/594786564');
  assert.equal(sharedLink(new URLSearchParams({ text: 'https://music.youtube.com/watch?v=abcdefghijk&si=x&feature=share' })), 'https://music.youtube.com/watch?v=abcdefghijk');
  assert.equal(sharedLink(new URLSearchParams({ text: 'no link here' })), null);
});
