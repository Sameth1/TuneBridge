import { LANGUAGES, STRINGS } from './i18n.js';
import { sharedLink } from './share.js';

const form = document.querySelector('#link-form');
const input = document.querySelector('#music-url');
const errorBox = document.querySelector('#form-error');
const result = document.querySelector('#result');
const submitButton = document.querySelector('#submit-button');
const LANGUAGE_KEY = 'tunebridge-language';
const PREFERRED_KEY = 'tunebridge-preferred-platform';
const HISTORY_ENABLED_KEY = 'tunebridge-history-enabled';
const HISTORY_KEY = 'tunebridge-history';
const HISTORY_LIMIT = 12;
const installButton = document.querySelector('#install-button');
const rememberChoice = document.querySelector('#remember-choice');
const autoOpen = document.querySelector('#auto-open');

let language = 'en';
let lastResult = null;
let lastError = null;
let autoOpenTimer = null;
let installPrompt = null;

// Everything below is optional per-visitor convenience: private mode can refuse storage.
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* keep going without it */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* keep going without it */ } }
};

function storedLanguage() { return storage.get(LANGUAGE_KEY); }

const t = key => STRINGS[language][key];

function applyLanguage(next) {
  language = LANGUAGES.includes(next) ? next : 'en';
  storage.set(LANGUAGE_KEY, language);
  document.documentElement.lang = language;
  document.querySelector('meta[name="description"]').content = t('metaDescription');
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  // Only our own dictionary strings are written as HTML.
  for (const element of document.querySelectorAll('[data-i18n-html]')) element.innerHTML = t(element.dataset.i18nHtml);
  for (const element of document.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.dataset.i18nAria));
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
  if (submitButton.disabled) submitButton.textContent = t('submitting');
  if (lastResult) render(lastResult.data, lastResult.shareUrl);
  else document.title = t('pageTitle');
  renderHistory();
  if (lastError) showError(lastError);
}

function errorMessage(error) {
  return STRINGS[language].errors[error.code] || error.message || t('genericError');
}

function showError(error) {
  lastError = error;
  errorBox.textContent = typeof error === 'string' ? t(error) : errorMessage(error);
  errorBox.hidden = false;
}
function hideError() { lastError = null; errorBox.hidden = true; errorBox.textContent = ''; }

async function loadSong(sourceUrl, updateHistory = true) {
  hideError();
  submitButton.disabled = true;
  submitButton.textContent = t('submitting');
  try {
    const localeCountry = navigator.language.match(/[-_]([A-Za-z]{2})$/)?.[1]?.toLowerCase() || 'us';
    const response = await fetch(`/api/resolve?url=${encodeURIComponent(sourceUrl)}&country=${localeCountry}`);
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || ''), { code: data.code || 'resolve_failed' });
    const shareUrl = new URL(`/s?url=${encodeURIComponent(sourceUrl)}`, location.origin).href;
    if (updateHistory) history.pushState({}, '', shareUrl);
    input.value = sourceUrl;
    lastResult = { data, shareUrl };
    render(data, shareUrl);
    remember(sourceUrl, data);
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    result.hidden = true;
    lastResult = null;
    showError({ code: error.code, message: error.message });
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = t('submit');
  }
}

function render(data, shareUrl) {
  document.title = `${data.song.title} — TuneBridge`;
  document.querySelector('#song-title').textContent = data.song.title;
  document.querySelector('#song-artist').textContent = data.song.artist || t('unknownArtist');
  const isAlbum = data.kind === 'album';
  // An album shows "ALBUM · 14 songs · 2001"; a song shows its album and duration.
  const album = isAlbum
    ? [t('albumLabel'), data.song.trackCount ? t('trackCount')(data.song.trackCount) : '', data.song.year || ''].filter(Boolean).join(' · ')
    : data.song.album || '';
  document.querySelector('#song-album').textContent = album;
  const seconds = !isAlbum && data.song.duration ? Math.round(data.song.duration / 1000) : 0;
  document.querySelector('#song-duration').textContent = seconds ? `${album ? ' · ' : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
  const artwork = document.querySelector('#artwork');
  artwork.replaceChildren();
  if (data.song.artwork) {
    const img = document.createElement('img');
    img.src = data.song.artwork;
    img.alt = t('artworkAlt')(data.song.title);
    artwork.append(img);
  } else artwork.textContent = '♫';
  document.querySelector('#share-url').textContent = shareUrl;
  const copyButton = document.querySelector('#copy-button');
  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copyButton.textContent = t('copied');
      setTimeout(() => copyButton.textContent = t('copy'), 2200);
    } catch { showError('copyFailed'); }
  };
  const nativeShare = document.querySelector('#native-share-button');
  nativeShare.hidden = !navigator.share;
  nativeShare.onclick = () => navigator.share({ title: data.song.title, text: `${data.song.title} — ${data.song.artist}`, url: shareUrl }).catch(() => {});
  const list = document.querySelector('#platform-list');
  list.replaceChildren();
  // The visitor's remembered app comes first, then exact links, then closest matches, then searches.
  const preferred = storage.get(PREFERRED_KEY);
  const kind = platform => platform.match || (platform.exact ? 'exact' : 'search');
  const rank = platform => (platform.id === preferred && platform.exact ? 0 : { exact: 1, close: 2, search: 3 }[kind(platform)]);
  for (const platform of [...data.platforms].sort((a, b) => rank(a) - rank(b))) {
    const item = document.createElement('a');
    item.className = 'platform';
    item.href = platform.url;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    // With "open in the app I pick" ticked, the tapped platform becomes the default for shared links.
    item.addEventListener('click', () => { if (rememberChoice.checked) storage.set(PREFERRED_KEY, platform.id); });
    const mark = document.createElement('span');
    mark.className = 'platform-mark';
    mark.style.background = platform.color;
    const logo = document.createElement('img');
    logo.src = platform.icon;
    logo.alt = '';
    mark.append(logo);
    const details = document.createElement('span');
    details.className = 'platform-details';
    const name = document.createElement('span');
    name.className = 'platform-name';
    name.textContent = platform.name;
    if (rank(platform) === 0) item.classList.add('platform-preferred');
    if (kind(platform) === 'close') item.classList.add('platform-close');
    const state = document.createElement('span');
    state.className = 'platform-state';
    // A closest match names what it found, so the listener can tell whether it is the right song.
    const closeName = [platform.matchTitle, platform.matchArtist].filter(Boolean).join(' — ');
    const status = { exact: t(isAlbum ? 'openAlbum' : 'openDirect'), close: [t('closeMatch'), closeName].filter(Boolean).join(': '), search: t('searchPlatform') }[kind(platform)];
    state.textContent = [rank(platform) === 0 ? t('preferred') : '', status].filter(Boolean).join(' · ');
    details.append(name, state);
    const arrow = document.createElement('span');
    arrow.className = 'platform-arrow';
    arrow.textContent = '↗';
    item.append(mark, details, arrow);
    list.append(item);
  }
}

for (const button of document.querySelectorAll('[data-lang]')) button.addEventListener('click', () => applyLanguage(button.dataset.lang));
// A shared link opens straight in the visitor's remembered app, with a moment to change their mind.
function startAutoOpen(data) {
  const preferred = storage.get(PREFERRED_KEY);
  const platform = data.platforms.find(candidate => candidate.id === preferred && candidate.exact);
  if (!platform) return;
  const text = document.querySelector('#auto-open-text');
  text.textContent = t('autoOpening')(platform.name);
  autoOpen.hidden = false;
  clearTimeout(autoOpenTimer);
  autoOpenTimer = setTimeout(() => { location.href = platform.url; }, 1800);
}

document.querySelector('#auto-open-cancel').addEventListener('click', () => { clearTimeout(autoOpenTimer); autoOpen.hidden = true; });
rememberChoice.checked = Boolean(storage.get(PREFERRED_KEY));
rememberChoice.addEventListener('change', () => { if (!rememberChoice.checked) storage.remove(PREFERRED_KEY); });

// "Add to home screen": Chrome offers it through beforeinstallprompt; the installed app then shows up in the Share menu.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => { installButton.hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// "Search new song": back to an empty link field, ready for the next paste.
document.querySelector('#new-search-button').addEventListener('click', () => {
  clearTimeout(autoOpenTimer);
  autoOpen.hidden = true;
  result.hidden = true;
  lastResult = null;
  hideError();
  input.value = '';
  document.title = t('pageTitle');
  history.pushState({}, '', '/');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  input.focus({ preventScroll: true });
});

// Search history is opt-in and stays in this browser; switching it off deletes it.
const historyEnabled = document.querySelector('#history-enabled');
const historyList = document.querySelector('#history-list');
const historyClear = document.querySelector('#history-clear');

function savedHistory() {
  try { return JSON.parse(storage.get(HISTORY_KEY) || '[]').filter(entry => entry?.url && entry?.title); } catch { return []; }
}

function remember(sourceUrl, data) {
  if (storage.get(HISTORY_ENABLED_KEY) !== '1') return;
  const entry = { url: sourceUrl, title: data.song.title, artist: data.song.artist || '', artwork: data.song.artwork || '', kind: data.kind || 'track', at: Date.now() };
  storage.set(HISTORY_KEY, JSON.stringify([entry, ...savedHistory().filter(item => item.url !== sourceUrl)].slice(0, HISTORY_LIMIT)));
  renderHistory();
}

function renderHistory() {
  const enabled = storage.get(HISTORY_ENABLED_KEY) === '1';
  historyEnabled.checked = enabled;
  const entries = enabled ? savedHistory() : [];
  historyClear.hidden = !entries.length;
  historyList.hidden = !enabled;
  historyList.replaceChildren();
  if (enabled && !entries.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = t('historyEmpty');
    historyList.append(empty);
  }
  for (const entry of entries) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    const art = document.createElement('span');
    art.className = 'history-art';
    if (entry.artwork) {
      const img = document.createElement('img');
      img.src = entry.artwork;
      img.alt = '';
      art.append(img);
    } else art.textContent = '♫';
    const text = document.createElement('span');
    text.className = 'history-text';
    const title = document.createElement('b');
    title.textContent = entry.title;
    const artist = document.createElement('small');
    artist.textContent = [entry.kind === 'album' ? t('albumLabel') : '', entry.artist].filter(Boolean).join(' · ');
    text.append(title, artist);
    button.append(art, text);
    button.addEventListener('click', () => { input.value = entry.url; loadSong(entry.url); });
    item.append(button);
    historyList.append(item);
  }
}

historyEnabled.addEventListener('change', () => {
  if (historyEnabled.checked) storage.set(HISTORY_ENABLED_KEY, '1');
  else { storage.remove(HISTORY_ENABLED_KEY); storage.remove(HISTORY_KEY); }
  renderHistory();
});
historyClear.addEventListener('click', () => { storage.remove(HISTORY_KEY); renderHistory(); });

// For a link someone sent in WhatsApp and the like: copy it, open TuneBridge, one tap.
const pasteButton = document.querySelector('#paste-button');
pasteButton.hidden = !navigator.clipboard?.readText;
pasteButton.addEventListener('click', async () => {
  try {
    const link = sharedLink(new URLSearchParams({ text: await navigator.clipboard.readText() }));
    if (!link) return showError('shareNoLink');
    input.value = link;
    loadSong(link);
  } catch { input.focus(); }
});

// Runs after every declaration above: applying the language also draws the history list.
applyLanguage(storedLanguage() || 'en');
form.addEventListener('submit', event => { event.preventDefault(); loadSong(input.value.trim()); });
const params = new URLSearchParams(location.search);
if (location.pathname === '/share') {
  // Opened from the phone's Share menu: this is the sender, so build the share page instead of auto-opening.
  const link = sharedLink(params);
  if (link) loadSong(link, false).then(() => history.replaceState({}, '', `/s?url=${encodeURIComponent(link)}`));
  else { history.replaceState({}, '', '/'); showError('shareNoLink'); }
} else if (params.get('url')) {
  loadSong(params.get('url'), false).then(() => { if (lastResult) startAutoOpen(lastResult.data); });
}
