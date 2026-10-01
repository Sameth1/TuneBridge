import { searchDeezer, deezerTrack } from './deezer.js';
import { itunesSearch, appleSong } from './apple.js';

// Someone else's upload of a song ("EZHEL-Başa Bela(sözleri lyrics)", "Başa Bela - Ezhel ( Ali Güneş Remix ) #TikTok")
// names the song somewhere in its title, among words about the upload. Searching a catalog with that title,
// then with fewer and fewer of its words, finds the release whose artist and name the title contains.

const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/ı/g, 'i');
const words = value => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const compact = value => words(value).join('');
const isYear = word => /^(19|20)\d\d$/.test(word);

// Words about the upload, not the song.
const NOISE = new Set(['official', 'offical', 'oficial', 'officiel', 'resmi', 'audio', 'video', 'videoklip', 'videoclip', 'klip', 'clip',
  'music', 'muzik', 'musik', 'lyric', 'lyrics', 'sozleri', 'sozler', 'sozlu', 'sarki', 'sarkisi', 'yeni', 'new', 'hd', 'hq', '4k', '8k',
  '1080p', '720p', 'full', 'hali', 'tam', 'translation', 'ceviri', 'cevirisi', 'english', 'turkce', 'altyazi', 'altyazili', 'subtitles',
  'subtitle', 'sub', 'subs', 'tiktok', 'trend', 'viral', 'akimi', 'visualizer', 'visualiser', 'mv', 'premiere', 'exclusive', 'teaser',
  'ft', 'feat', 'featuring', 'x', 've', 'and', 'prod']);

// Words that mean the upload is another version of the song, shown as the label in brackets.
const VERSIONS = {
  remix: 'Remix', remiks: 'Remix', rmx: 'Remix', mix: 'Mix', mashup: 'Mashup', edit: 'Edit', bootleg: 'Bootleg',
  live: 'Live', canli: 'Live', konser: 'Live', concert: 'Live', performans: 'Live', performance: 'Live', session: 'Live',
  cover: 'Cover', sped: 'Sped Up', speed: 'Sped Up', slowed: 'Slowed', reverb: 'Slowed + Reverb', boosted: 'Bass Boosted',
  '8d': '8D', nightcore: 'Nightcore', acoustic: 'Acoustic', akustik: 'Acoustic', instrumental: 'Instrumental',
  enstrumantal: 'Instrumental', karaoke: 'Karaoke', saatlik: 'Loop', hour: 'Loop', hours: 'Loop', loop: 'Loop',
  yayinlanmamis: 'Unreleased', unreleased: 'Unreleased', demo: 'Demo', stage: 'Live', unplugged: 'Live'
};

const BRACKETS = /[([{【]([^)\]}】]*)[)\]}】]?/g;

// The title without hashtags, mentions, symbols and brackets that only describe the upload.
function cleanUpload(title) {
  return String(title || '')
    .replace(/[#@]\S+/g, ' ')
    .replace(BRACKETS, (match, inner) => {
      const list = words(inner);
      return list.every(word => NOISE.has(word) || isYear(word)) || list.includes('prod') ? ' ' : ` ${inner} `;
    });
}

const tokens = text => text.split(/[^\p{L}\p{N}'’&.]+/u).map(token => token.replace(/^[.&'’]+|[.&'’]+$/g, '')).filter(Boolean);

// Search phrases, most complete first: every word, then without version words, then dropping words from
// the end (trailing remixer or uploader names) and from the start (a leading second artist).
export function uploadSearches(title, max = 10, channel = '') {
  const all = tokens(cleanUpload(title)).filter(token => !NOISE.has(fold(token)) && !isYear(fold(token)));
  const plain = all.filter(token => !VERSIONS[fold(token)]);
  // A quoted name is the song's ("BTS (방탄소년단) 'Dynamite' @ …"), searched first with the channel's name.
  const quoted = String(title || '').match(/(?:^|\s)['‘"“]([^'’"”]{2,60})['’"”](?=\s|$)/u)?.[1];
  const phrases = [...(quoted ? [[quoted, ...tokens(channel)]] : []), all, plain];
  for (let end = plain.length - 1; end >= 2; end--) phrases.push(plain.slice(0, end));
  for (let start = 1; plain.length - start >= 2 && start <= 2; start++) phrases.push(plain.slice(start));
  return [...new Set(phrases.map(list => list.join(' ')).filter(Boolean))].slice(0, max);
}

const artistNames = artist => String(artist || '').split(/,|&| feat\.? | ft\.? | x | ve /i).map(compact).filter(name => name.length >= 2);
const coreTitle = title => String(title || '').replace(/\s*[([{【].*?[)\]}】]/g, '').replace(/\s[-–—]\s.*$/, '');

// How well a catalog song explains the upload title, or null when the title does not name it.
export function explains(upload, candidate) {
  const titleCompact = compact(upload.title);
  const uploadWords = new Set(words(upload.title));
  const core = words(coreTitle(candidate.title));
  if (!core.length || !candidate.artist) return null;
  const titleNamed = core.every(word => uploadWords.has(word)) || (compact(coreTitle(candidate.title)).length >= 4 && titleCompact.includes(compact(coreTitle(candidate.title))));
  if (!titleNamed) return null;
  const channel = compact(upload.channel);
  const artistNamed = artistNames(candidate.artist).some(name => titleCompact.includes(name) || (channel && (channel === name || (name.length >= 4 && channel.includes(name)))));
  const meaningful = [...uploadWords].filter(word => !NOISE.has(word) && !isYear(word));
  const explained = new Set([...words(candidate.title), ...words(candidate.artist)]);
  const coverage = meaningful.length ? meaningful.filter(word => explained.has(word)).length / meaningful.length : 0;
  const gap = upload.duration && candidate.duration ? Math.abs(upload.duration - candidate.duration) : null;
  // Without the artist in the title, only the full name at the same length identifies the song, and only as closest.
  if (!artistNamed && !(meaningful.every(word => explained.has(word)) && gap !== null && gap <= 3000)) return null;
  const versions = [...uploadWords].filter(word => VERSIONS[word] && !explained.has(word));
  // "… @ America's Got Talent", "@ M COUNTDOWN": a performance on a show or stage.
  const onStage = /\s@\s/.test(upload.title);
  if (onStage && !explained.has('live') && !versions.includes('live')) versions.push('live');
  // A catalog version of the same kind (another live take, another remix) is the same recording only at the same length.
  const sameKind = [...uploadWords].some(word => VERSIONS[word] && explained.has(word)) || (onStage && explained.has('live'));
  const own = words(candidate.title).filter(word => VERSIONS[word]).length;
  // Lyric and fan uploads often trim a few seconds; more than 15 s apart is an excerpt or another take.
  // An artist's own music video may add an intro or outro, up to 90 s.
  // Live takes of one song run alike, so another live recording must also name the same show or concert.
  const otherShow = sameKind && (onStage || uploadWords.has('live') || uploadWords.has('canli')) && coverage < 0.9;
  const altered = !artistNamed || versions.length > 0 || otherShow || (sameKind && (gap === null || gap > 8000)) ||
    (gap !== null && gap > (upload.official ? 90000 : 15000));
  return { coverage, gap, altered, versions, own };
}

function best(upload, candidates) {
  return candidates
    .map((candidate, rank) => ({ candidate, rank, fit: explains(upload, candidate) }))
    .filter(entry => entry.fit)
    // Another version of the song is shown against the original release, not against a different version.
    .sort((a, b) => Number(a.fit.altered) - Number(b.fit.altered) || (a.fit.altered ? a.fit.own - b.fit.own : 0) ||
      b.fit.coverage - a.fit.coverage || (a.fit.gap ?? 1e9) - (b.fit.gap ?? 1e9) || a.rank - b.rank)[0] || null;
}

// "(Vedat Unal Remix)" from the upload title, or a label for its version words.
function versionLabel(title, versions) {
  for (const [, inner] of String(title || '').matchAll(BRACKETS)) {
    if (words(inner).some(word => VERSIONS[word])) return inner.trim();
  }
  return [...new Set(versions.map(word => VERSIONS[word]))].join(' ');
}

// The catalog song an upload contains: { song, altered, label } where `altered` means a remix, live take,
// excerpt or other version, which other platforms can only offer as the closest result.
export async function identifyUpload(upload, country = 'us') {
  const phrases = uploadSearches(upload.title, 10, upload.channel);
  let found = null;
  for (const phrase of phrases) {
    found = best(upload, await searchDeezer(phrase));
    if (found && !found.fit.altered) break;
    if (found) {
      // A remix or live upload: a later, shorter phrase may still find that very version or the original.
      const plainer = best(upload, await searchDeezer(phrases[phrases.length - 1]));
      if (plainer && (!plainer.fit.altered || plainer.fit.coverage > found.fit.coverage)) found = plainer;
      break;
    }
  }
  // Not on Deezer: the iTunes catalog, with the two most complete phrases (it allows few requests).
  for (const phrase of found ? [] : phrases.slice(1, 3)) {
    found = best(upload, (await itunesSearch(phrase, country).catch(() => [])).map(appleSong));
    if (found) break;
  }
  if (!found) return null;
  const song = found.candidate.id ? (await deezerTrack(found.candidate.id)) || found.candidate : found.candidate;
  const { track, id, ...clean } = song;
  return { song: clean, altered: found.fit.altered, label: found.fit.altered ? versionLabel(upload.title, found.fit.versions) : '' };
}
