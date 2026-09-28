import sharp from 'sharp';

const allowedHosts = ['mzstatic.com', 'spotifycdn.com', 'scdn.co', 'dzcdn.net'];
const signatures = new Map();

export async function artworkSignature(imageUrl) {
  if (!imageUrl) return null;
  let url;
  try { url = new URL(imageUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  if (signatures.has(url.href)) return signatures.get(url.href);
  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 2_000_000) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2_000_000) return null;
      const { data } = await sharp(bytes).resize(24, 24, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return data;
    } finally { clearTimeout(timer); }
  })().catch(() => null);
  signatures.set(url.href, pending);
  return pending;
}

export function artworkSimilarity(first, second) {
  if (!first || !second || first.length !== second.length) return null;
  let difference = 0;
  for (let i = 0; i < first.length; i++) difference += Math.abs(first[i] - second[i]);
  return 1 - difference / (first.length * 255);
}

export function selectArtworkCandidate(scored) {
  const ranked = [...scored].sort((a, b) => b.similarity - a.similarity);
  const winner = ranked[0];
  if (!winner || winner.similarity < 0.97) return null;
  const conflicting = ranked.slice(1).some(({ track, similarity }) =>
    similarity >= winner.similarity - 0.04 &&
    (track.artistName !== winner.track.artistName ||
      Math.abs(track.trackTimeMillis - winner.track.trackTimeMillis) > 3000));
  return conflicting ? null : winner;
}
