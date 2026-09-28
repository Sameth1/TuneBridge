import test from 'node:test';
import assert from 'node:assert/strict';
import { selectArtworkCandidate } from './artwork.js';

test('accepts a unique near-identical cover and rejects close conflicting candidates', () => {
  const intended = { artistName: 'Carly Rae Jepsen', trackTimeMillis: 207960 };
  const other = { artistName: 'Mini Pop Kids', trackTimeMillis: 206176 };
  assert.equal(selectArtworkCandidate([
    { track: intended, similarity: 0.997 },
    { track: other, similarity: 0.737 }
  ])?.track, intended);
  assert.equal(selectArtworkCandidate([
    { track: intended, similarity: 0.997 },
    { track: other, similarity: 0.982 }
  ]), null);
  assert.equal(selectArtworkCandidate([{ track: intended, similarity: 0.91 }]), null);
});
