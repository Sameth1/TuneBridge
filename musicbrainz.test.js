import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRecordingId, extractLinks } from './musicbrainz.js';

const spotify = 'https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq';

test('selects the recording linked to a Spotify URL', () => {
  const data = { relations: [{ 'target-type': 'recording', recording: { id: 'recording-1', title: 'Get Lucky' } }] };
  assert.equal(pickRecordingId(data, 'Get Lucky (feat. Pharrell Williams)'), 'recording-1');
});

test('accepts only song relations from a recording containing the source Spotify ID', () => {
  const recording = { relations: [
    { url: { resource: spotify } },
    { url: { resource: 'https://music.apple.com/us/song/get-lucky/617154366' } },
    { url: { resource: 'https://music.apple.com/gb/song/get-lucky/1673536443' } },
    { url: { resource: 'https://www.deezer.com/album/123' } },
    { url: { resource: 'https://music.youtube.com/watch?v=4D7u5KF7SP8' } }
  ] };
  const links = extractLinks(recording, spotify, 'gb');
  assert.equal(links.apple, 'https://music.apple.com/gb/song/get-lucky/1673536443');
  assert.equal(links.youtubeMusic, 'https://music.youtube.com/watch?v=4D7u5KF7SP8');
  assert.equal(links.deezer, undefined);
  assert.deepEqual(extractLinks(recording, 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'), {});
});
