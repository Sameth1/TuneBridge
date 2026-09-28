import { LANGUAGES, STRINGS } from './i18n.js';

const form = document.querySelector('#link-form');
const input = document.querySelector('#music-url');
const errorBox = document.querySelector('#form-error');
const result = document.querySelector('#result');
const submitButton = document.querySelector('#submit-button');
const LANGUAGE_KEY = 'tunebridge-language';

let language = 'en';
let lastResult = null;
let lastError = null;

function storedLanguage() {
  try { return localStorage.getItem(LANGUAGE_KEY); } catch { return null; }
}

const t = key => STRINGS[language][key];

function applyLanguage(next) {
  language = LANGUAGES.includes(next) ? next : 'en';
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Private mode: keep the choice for this visit only. */ }
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
  const album = data.song.album || '';
  document.querySelector('#song-album').textContent = album;
  const seconds = data.song.duration ? Math.round(data.song.duration / 1000) : 0;
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
  for (const platform of [...data.platforms].sort((a, b) => Number(b.exact) - Number(a.exact))) {
    const item = document.createElement('a');
    item.className = 'platform';
    item.href = platform.url;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    const mark = document.createElement('span');
    mark.className = 'platform-mark';
    mark.style.background = platform.color;
    mark.textContent = platform.mark;
    const details = document.createElement('span');
    details.className = 'platform-details';
    const name = document.createElement('span');
    name.className = 'platform-name';
    name.textContent = platform.name;
    const state = document.createElement('span');
    state.className = 'platform-state';
    state.textContent = platform.exact ? t('openDirect') : t('searchPlatform');
    details.append(name, state);
    const arrow = document.createElement('span');
    arrow.className = 'platform-arrow';
    arrow.textContent = '↗';
    item.append(mark, details, arrow);
    list.append(item);
  }
}

for (const button of document.querySelectorAll('[data-lang]')) button.addEventListener('click', () => applyLanguage(button.dataset.lang));
applyLanguage(storedLanguage() || 'en');
form.addEventListener('submit', event => { event.preventDefault(); loadSong(input.value.trim()); });
const shared = new URLSearchParams(location.search).get('url');
if (shared) loadSong(shared, false);
