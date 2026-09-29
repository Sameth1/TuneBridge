// The first http(s) link in what another app shared. Android puts it in `text`
// ("Listen to Divane by Yaşar https://open.spotify.com/…"), others in `url`.
export function sharedLink(params) {
  for (const key of ['url', 'text', 'title']) {
    const match = (params.get(key) || '').match(/https?:\/\/[^\s<>"]+/);
    if (match) return withoutTracking(match[0]);
  }
  return null;
}

// Share links carry per-sender tracking ("si" on Spotify and YouTube); the shared page should not pass it on.
const TRACKING = /^(si|feature|igsh|fbclid|gclid|utm_.+|ref|referral|app|ls|at|ct)$/i;

export function withoutTracking(link) {
  try {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return link; }
}
