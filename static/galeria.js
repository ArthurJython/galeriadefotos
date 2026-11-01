// ---------- Estado ----------
const state = {
  view: 'albums',
  albums: [],
  albumId: null,
  upload: {
    file: null,
    uploading: false,
    count: 0,        // uploads bem-sucedidos nesta sessão
    lastAt: 0,       // timestamp do último upload bem-sucedido
  },
};

const TITLES = {
  albums:    'Meus álbuns',
  special:   'Momentos especiais',
  favorites: 'Favoritos',
  settings:  'Configurações',
  photos:    'Mídias do álbum',
};

// Anti-spam (UX): cooldown e teto de uploads.
// Defesa real fica no backend (MAX_CONTENT_LENGTH, magic bytes, ownership).
const UPLOAD_COOLDOWN_MS = 3000;
const MAX_UPLOADS_PER_SESSION = 20;

// ---------- DOM ----------
const viewEl    = document.getElementById('view');
const pageTitle = document.getElementById('page-title');
const navItems  = document.querySelectorAll('.nav-item');
const searchEl  = document.getElementById('search');
const logoutBtn = document.getElementById('btn-logout');

// Upload modal
const modal       = document.getElementById('upload-modal');
const modalClose  = document.getElementById('upload-close');
const modalCancel = document.getElementById('upload-cancel');
const fileInput   = document.getElementById('upload-file');
const dropZone    = document.getElementById('drop-zone');
const fileInfo    = document.getElementById('file-info');
const fileNameEl  = document.getElementById('file-name');
const fileSizeEl  = document.getElementById('file-size');
const titleInput  = document.getElementById('upload-title');
const progress    = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const uploadError = document.getElementById('upload-error');
const uploadBtn   = document.getElementById('upload-submit');

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
]);

// ---------- Helpers ----------
async function api(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('unauthenticated');
  }
  if (!res.ok) throw new Error('api error');
  return res.json();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function setActiveNav(view) {
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === view));
}

function loading() { viewEl.innerHTML = '<div class="loading">Carregando…</div>'; }
function empty(icon, msg) {
  viewEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon}</div><p>${msg}</p></div>`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Render: Álbuns ----------
function renderAlbumsView(albums) {
  if (!albums.length) { empty('▦', 'Nenhum álbum por aqui ainda.'); return; }
  const grid = document.createElement('div');
  grid.className = 'albums-grid';
  albums.forEach(a => {
    const card = el(`
      <article class="album-card" data-id="${a.id}">
        <div class="album-cover">
          <img src="${escapeHtml(a.cover_url)}" alt="${escapeHtml(a.name)}" loading="lazy">
          ${a.is_special ? '<span class="album-special">Especial</span>' : ''}
          <span class="album-badge">${a.fotos_count} ${a.fotos_count === 1 ? 'item' : 'itens'}</span>
        </div>
        <div class="album-meta">
          <h3>${escapeHtml(a.name)}</h3>
          <p>${escapeHtml(a.description || 'Sem descrição')}</p>
        </div>
      </article>
    `);
    grid.appendChild(card);
  });
  viewEl.innerHTML = '';
  viewEl.appendChild(grid);
}

// ---------- Render: Mídias do álbum ----------
function renderMediasView(album, medias) {
  const header = el(`
    <div class="view-header">
      <button class="btn-back" id="btn-back">← Voltar</button>
      <h2>${escapeHtml(album.name)}</h2>
      <button class="btn-primary btn-add" id="btn-add">+ Adicionar mídia</button>
    </div>
  `);

  const grid = document.createElement('div');
  grid.className = 'photo-grid';

  if (!medias.length) {
    grid.innerHTML = '<p style="color:var(--muted)">Nenhuma mídia neste álbum. Adicione a primeira.</p>';
  } else {
    medias.forEach(m => {
      let inner;
      if (m.type === 'video') {
        inner = `
          <video src="${escapeHtml(m.url)}"
                 ${m.thumb_url ? `poster="${escapeHtml(m.thumb_url)}"` : ''}
                 controls preload="metadata" playsinline></video>
          <span class="media-badge">▶</span>
        `;
      } else {
        inner = `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.title || '')}" loading="lazy">`;
      }
      const item = el(`
        <div class="photo-item ${m.type === 'video' ? 'is-video' : ''}"
             title="${escapeHtml(m.title || '')}">
          ${inner}
          ${m.is_favorite ? '<span class="photo-fav">♥</span>' : ''}
        </div>
      `);
      grid.appendChild(item);
    });
  }

  viewEl.innerHTML = '';
  viewEl.appendChild(header);
  viewEl.appendChild(grid);

  document.getElementById('btn-back').addEventListener('click', () => {
    state.view = state._prevView || 'albums';
    state.albumId = null;
    render();
  });
  document.getElementById('btn-add').addEventListener('click', openUploadModal);
}

// ---------- Render: Favoritos ----------
function renderFavoritesView(medias) {
  if (!medias.length) { empty('♥', 'Você ainda não favoritou nada.'); return; }
  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  medias.forEach(m => {
    let inner = m.type === 'video'
      ? `<video src="${escapeHtml(m.url)}" ${m.thumb_url ? `poster="${escapeHtml(m.thumb_url)}"` : ''} controls preload="metadata" playsinline></video><span class="media-badge">▶</span>`
      : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.title || '')}" loading="lazy">`;
    const item = el(`
      <div class="photo-item ${m.type === 'video' ? 'is-video' : ''}"
           title="${escapeHtml(m.album_name)} — ${escapeHtml(m.title || '')}">
        ${inner}
        <span class="photo-fav">♥</span>
      </div>
    `);
    grid.appendChild(item);
  });
  viewEl.innerHTML = '';
  viewEl.appendChild(grid);
}

// ---------- Configurações ----------
function renderSettingsView() {
  viewEl.innerHTML = `
    <div class="settings-panel">
      <div class="settings-section">
        <h3>Conta</h3>
        <div class="settings-row">
          <span>Usuário</span><strong>${escapeHtml(window.__USERNAME__ || '')}</strong>
        </div>
        <div class="settings-row">
          <span>Sessão</span>
          <button class="btn-danger" id="btn-logout-2">Sair agora</button>
        </div>
      </div>
      <div class="settings-section">
        <h3>Preferências</h3>
        <div class="settings-row"><span>Tema</span><strong>Escuro (padrão)</strong></div>
        <div class="settings-row"><span>Limite de upload</span><strong>50 MB por arquivo</strong></div>
        <div class="settings-row"><span>Uploads nesta sessão</span><strong>${state.upload.count} / ${MAX_UPLOADS_PER_SESSION}</strong></div>
      </div>
    </div>
  `;
  document.getElementById('btn-logout-2')?.addEventListener('click', doLogout);
}

// ---------- Render principal ----------
async function render() {
  setActiveNav(state.view);
  pageTitle.textContent = TITLES[state.view] || '';
  searchEl.style.display = (state.view === 'albums' || state.view === 'special') ? '' : 'none';

  if (state.view === 'albums' || state.view === 'special') {
    loading();
    try {
      const albums = await api('/api/albums');
      state.albums = albums;
      const list = state.view === 'special' ? albums.filter(a => a.is_special) : albums;
      applySearchAndRender(list);
    } catch (e) {}
    return;
  }
  if (state.view === 'favorites') {
    loading();
    try { renderFavoritesView(await api('/api/medias/favorites')); } catch (e) {}
    return;
  }
  if (state.view === 'settings') { renderSettingsView(); return; }
  if (state.view === 'photos' && state.albumId) {
    loading();
    try {
      const data = await api(`/api/albums/${state.albumId}/medias`);
      renderMediasView(data.album, data.medias);
    } catch (e) {}
    return;
  }
}

function applySearchAndRender(albums) {
  const q = (searchEl.value || '').trim().toLowerCase();
  const filtered = q ? albums.filter(a => a.name.toLowerCase().includes(q)) : albums;
  renderAlbumsView(filtered);
}

// ---------- Upload ----------
function openUploadModal() {
  // Guard: modal só abre dentro de um álbum
  if (!state.albumId) return;

  // Teto de uploads por sessão
  if (state.upload.count >= MAX_UPLOADS_PER_SESSION) {
    return;
  }

  state.upload.file = null;
  state.upload.uploading = false;
  fileInput.value = '';
  titleInput.value = '';
  fileInfo.hidden = true;
  progress.hidden = true;
  progressBar.style.width = '0%';
  uploadError.textContent = '';
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Enviar';
  modal.hidden = false;
  titleInput.focus();
}

function closeUploadModal() {
  if (state.upload.uploading) return;
  modal.hidden = true;
  state.upload.file = null;
}

function setFile(file) {
  uploadError.textContent = '';

  if (!file) {
    state.upload.file = null;
    fileInfo.hidden = true;
    uploadBtn.disabled = true;
    return;
  }

  // Validação cliente (servidor revalida)
  if (!ALLOWED_MIMES.has(file.type)) {
    uploadError.textContent = 'Tipo não aceito. Use jpg/png/gif/webp ou mp4/webm.';
    state.upload.file = null;
    fileInfo.hidden = true;
    uploadBtn.disabled = true;
    return;
  }
  if (file.size > MAX_BYTES) {
    uploadError.textContent = `Arquivo muito grande (${fmtBytes(file.size)}). Máximo: 50 MB.`;
    state.upload.file = null;
    fileInfo.hidden = true;
    uploadBtn.disabled = true;
    return;
  }

  state.upload.file = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = fmtBytes(file.size);
  fileInfo.hidden = false;
  uploadBtn.disabled = false;
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0] || null));
modalClose.addEventListener('click', closeUploadModal);
modalCancel.addEventListener('click', closeUploadModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeUploadModal(); });

// Drag & drop
['dragenter', 'dragover'].forEach(ev =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach(ev =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); })
);
dropZone.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) setFile(f);
});

uploadBtn.addEventListener('click', async () => {
  // Guards anti-spam
  if (!state.upload.file || state.upload.uploading) return;

  if (!state.albumId) {
    uploadError.textContent = 'Nenhum álbum selecionado.';
    return;
  }

  if (state.upload.count >= MAX_UPLOADS_PER_SESSION) {
    uploadError.textContent = `Limite de ${MAX_UPLOADS_PER_SESSION} uploads por sessão atingido. Recarregue a página.`;
    return;
  }

  const elapsed = Date.now() - state.upload.lastAt;
  if (state.upload.lastAt && elapsed < UPLOAD_COOLDOWN_MS) {
    const wait = Math.ceil((UPLOAD_COOLDOWN_MS - elapsed) / 1000);
    uploadError.textContent = `Aguarde ${wait}s antes de enviar outro arquivo.`;
    return;
  }

  state.upload.uploading = true;
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Enviando…';
  uploadError.textContent = '';
  progress.hidden = false;
  progressBar.style.width = '0%';

  try {
    await uploadMedia(
      state.albumId,
      state.upload.file,
      titleInput.value.trim(),
      (p) => { progressBar.style.width = `${Math.round(p * 100)}%`; }
    );

    // Sucesso: atualiza contadores anti-spam
    state.upload.count += 1;
    state.upload.lastAt = Date.now();

    state.upload.uploading = false;
    modal.hidden = true;
    render();
  } catch (err) {
    state.upload.uploading = false;
    uploadError.textContent = err.message || 'Falha no upload.';
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Enviar';
    progress.hidden = true;
  }
});

function uploadMedia(albumId, file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/albums/${albumId}/upload`);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Resposta inválida do servidor')); }
      } else if (xhr.status === 413) {
        reject(new Error('Arquivo muito grande (máximo 50 MB)'));
      } else {
        let msg = 'Falha no upload';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede')));
    xhr.addEventListener('abort', () => reject(new Error('Cancelado')));

    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    xhr.send(fd);
  });
}

// ---------- Navegação ----------
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.view === 'photos') state._prevView = null;
    state.view = item.dataset.view;
    state.albumId = null;
    render();
  });
});

viewEl.addEventListener('click', (e) => {
  const card = e.target.closest('.album-card');
  if (!card) return;
  state._prevView = state.view;
  state.albumId = card.dataset.id;
  state.view = 'photos';
  render();
});

let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (state.view === 'albums' || state.view === 'special') {
      const albums = state.view === 'special'
        ? state.albums.filter(a => a.is_special)
        : state.albums;
      applySearchAndRender(albums);
    }
  }, 150);
});

// ---------- Logout ----------
async function doLogout() {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { window.location.href = '/'; }
}
logoutBtn.addEventListener('click', doLogout);

// ---------- Init ----------
window.__USERNAME__ = document.querySelector('.user-name')?.textContent?.trim() || '';
render();