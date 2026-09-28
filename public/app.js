const form = document.querySelector('#link-form');
const input = document.querySelector('#music-url');
const errorBox = document.querySelector('#form-error');
const result = document.querySelector('#result');
const submitButton = document.querySelector('#submit-button');

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

async function loadSong(sourceUrl, updateHistory = true) {
  hideError();
  submitButton.disabled = true;
  submitButton.textContent = 'Şarkı aranıyor…';
  try {
    const localeCountry = navigator.language.match(/[-_]([A-Za-z]{2})$/)?.[1]?.toLowerCase() || 'us';
    const response = await fetch(`/api/resolve?url=${encodeURIComponent(sourceUrl)}&country=${localeCountry}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Şarkı bulunamadı.');
    const shareUrl = new URL(`/s?url=${encodeURIComponent(sourceUrl)}`, location.origin).href;
    if (updateHistory) history.pushState({}, '', shareUrl);
    input.value = sourceUrl;
    render(data, shareUrl);
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    result.hidden = true;
    showError(error.message || 'Bir hata oluştu.');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Bağlantı oluştur <span>→</span>';
  }
}

function render(data, shareUrl) {
  document.title = `${data.song.title} — TuneBridge`;
  document.querySelector('#song-title').textContent = data.song.title;
  document.querySelector('#song-artist').textContent = data.song.artist || 'Sanatçı bilgisi doğrulanamadı';
  const album = data.song.album || '';
  document.querySelector('#song-album').textContent = album;
  const seconds = data.song.duration ? Math.round(data.song.duration / 1000) : 0;
  document.querySelector('#song-duration').textContent = seconds ? `${album ? ' · ' : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
  const artwork = document.querySelector('#artwork');
  artwork.replaceChildren();
  if (data.song.artwork) {
    const img = document.createElement('img');
    img.src = data.song.artwork;
    img.alt = `${data.song.title} kapak görseli`;
    artwork.append(img);
  } else artwork.textContent = '♫';
  document.querySelector('#share-url').textContent = shareUrl;
  document.querySelector('#copy-button').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      const button = document.querySelector('#copy-button');
      button.textContent = 'Kopyalandı ✓';
      setTimeout(() => button.textContent = 'Bağlantıyı kopyala', 2200);
    } catch { showError('Kopyalama başarısız. Bağlantıyı seçip elle kopyalayabilirsin.'); }
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
    state.textContent = platform.exact ? 'Şarkıyı doğrudan aç' : 'Platformda ara';
    details.append(name, state);
    const arrow = document.createElement('span');
    arrow.className = 'platform-arrow';
    arrow.textContent = '↗';
    item.append(mark, details, arrow);
    list.append(item);
  }
}

form.addEventListener('submit', event => { event.preventDefault(); loadSong(input.value.trim()); });
const shared = new URLSearchParams(location.search).get('url');
if (shared) loadSong(shared, false);
