// ---------- Estado ----------
const state = {
  view: 'albums',           // albums | special | loose | favorites | settings | photos | search
  albums: [],
  albumId: null,            // id numérico para álbum; null em loose/favorites
  upload: { file: null, uploading: false, count: 0, lastAt: 0 },
  search: { query: '', timer: null, lastView: 'albums' },
  editingAlbum: null,
  editingMedia: null,
};

const TITLES = {
  albums:    'Meus álbuns',
  special:   'Momentos especiais',
  loose:     'Fotos soltas',
  favorites: 'Favoritos',
  settings:  'Configurações',
  photos:    'Álbum',
  search:    'Busca',
};

const UPLOAD_COOLDOWN_MS = 3000;
const MAX_UPLOADS_PER_SESSION = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
]);

// ---------- DOM ----------
const viewEl    = document.getElementById('view');
const pageTitle = document.getElementById('page-title');
const navItems  = document.querySelectorAll('.nav-item');
const searchEl  = document.getElementById('search');
const logoutBtn = document.getElementById('btn-logout');

// Upload modal
const uploadModal    = document.getElementById('upload-modal');
const uploadModalT   = document.getElementById('upload-modal-title');
const uploadClose    = document.getElementById('upload-close');
const uploadCancel   = document.getElementById('upload-cancel');
const uploadFileIn   = document.getElementById('upload-file');
const dropZone       = document.getElementById('drop-zone');
const fileInfo       = document.getElementById('file-info');
const fileNameEl     = document.getElementById('file-name');
const fileSizeEl     = document.getElementById('file-size');
const uploadTitleIn  = document.getElementById('upload-title');
const progress       = document.getElementById('progress');
const progressBar    = document.getElementById('progress-bar');
const uploadError    = document.getElementById('upload-error');
const uploadBtn      = document.getElementById('upload-submit');

// Album edit modal
const albumEditModal  = document.getElementById('album-edit-modal');
const albumEditClose  = document.getElementById('album-edit-close');
const albumEditCancel = document.getElementById('album-edit-cancel');
const albumEditDelete = document.getElementById('album-edit-delete');
const albumEditSave   = document.getElementById('album-edit-save');
const albumEditName   = document.getElementById('album-edit-name');
const albumEditDesc   = document.getElementById('album-edit-desc');
const albumEditSpec   = document.getElementById('album-edit-special');
const albumEditErr    = document.getElementById('album-edit-error');

// Media edit modal
const mediaEditModal    = document.getElementById('media-edit-modal');
const mediaEditClose    = document.getElementById('media-edit-close');
const mediaEditCancel   = document.getElementById('media-edit-cancel');
const mediaEditDelete   = document.getElementById('media-edit-delete');
const mediaEditSave     = document.getElementById('media-edit-save');
const mediaPreview      = document.getElementById('media-preview');
const mediaEditTitle    = document.getElementById('media-edit-title');
const mediaEditAlbum    = document.getElementById('media-edit-album');
const mediaEditFav      = document.getElementById('media-edit-fav');
const mediaEditReplace  = document.getElementById('media-edit-replace-btn');
const mediaEditReplaceI = document.getElementById('media-edit-replace-input');
const mediaEditErr      = document.getElementById('media-edit-error');

// Lightbox
const lightbox      = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxClose = document.getElementById('lightbox-close');

// ---------- Helpers ----------
async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('unauthenticated');
  }
  return res;
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

// ---------- Lightbox ----------
function openLightbox(src, title) {
  lightboxImage.src = src;
  lightboxImage.alt = title || '';
  lightboxTitle.textContent = title || 'Sem título';
  lightboxImage.classList.remove('zoomed');
  lightboxImage.style.width = '';
  lightboxImage.style.height = '';
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.src = '';
  lightboxImage.classList.remove('zoomed');
  lightboxImage.style.width = '';
  lightboxImage.style.height = '';
  lightboxTitle.textContent = '';
  document.body.style.overflow = '';
}

lightboxClose.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
});

// Clique na imagem para zoom no cursor
lightboxImage.addEventListener('click', (e) => {
  e.stopPropagation();

  if (lightboxImage.classList.contains('zoomed')) {
    lightboxImage.classList.remove('zoomed');
    lightboxImage.style.width = '';
    lightboxImage.style.height = '';
    lightbox.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    return;
  }

  const rect = lightboxImage.getBoundingClientRect();
  const clickX = e.clientX;
  const clickY = e.clientY;

  const pctX = (clickX - rect.left) / rect.width;
  const pctY = (clickY - rect.top) / rect.height;

  lightboxImage.classList.add('zoomed');

  // Força um leve zoom se a imagem for menor que a tela (para não parecer que nada aconteceu)
  if (lightboxImage.naturalWidth < rect.width) {
    lightboxImage.style.width = (rect.width * 1.5) + 'px';
    lightboxImage.style.height = (rect.height * 1.5) + 'px';
  }

  requestAnimationFrame(() => {
    const newRect = lightboxImage.getBoundingClientRect();
    const targetX = newRect.width * pctX;
    const targetY = newRect.height * pctY;
    
    // Calcula o deslocamento necessário para manter o clique sob o cursor
    const shiftX = (newRect.left + targetX) - clickX;
    const shiftY = (newRect.top + targetY) - clickY;
    
    lightbox.scrollLeft += shiftX;
    lightbox.scrollTop += shiftY;
  });
});

// ---------- Render: Álbuns ----------
function renderAlbumsView(albums) {
  if (!albums.length) { empty('▦', 'Nenhum álbum por aqui ainda.'); return; }
  const grid = document.createElement('div');
  grid.className = 'albums-grid';
  albums.forEach(a => {
    const coverHtml = a.cover_url
      ? `<img src="${escapeHtml(a.cover_url)}" alt="${escapeHtml(a.name)}" loading="lazy">`
      : `<div class="album-cover-empty"><span class="album-cover-icon">▦</span></div>`;
    const card = el(`
      <article class="album-card" data-id="${a.id}">
        <div class="album-cover">
          ${coverHtml}
          <button class="album-edit-btn" data-album-edit="${a.id}" title="Editar álbum">✎</button>
        </div>
        <div class="album-meta">
          <h3>${escapeHtml(a.name)} ${a.is_special ? '<span class="special-dot">●</span>' : ''}</h3>
          <p>${escapeHtml(a.description || 'Sem descrição')} · ${a.fotos_count} ${a.fotos_count === 1 ? 'item' : 'itens'}</p>
        </div>
      </article>
    `);
    grid.appendChild(card);
  });
  viewEl.innerHTML = '';
  viewEl.appendChild(grid);
}

// ---------- Render: Mídias ----------
function mediaItemHtml(m, showAlbumTag) {
  const inner = m.type === 'video'
    ? `<video src="${escapeHtml(m.url)}" preload="none" playsinline muted></video>
       <span class="media-badge">▶</span>`
    : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.title || '')}" loading="lazy">`;
  const albumTag = (showAlbumTag && m.album_name)
    ? `<span class="media-album-tag">${escapeHtml(m.album_name)}</span>` : '';
  return `
    <div class="photo-item ${m.type === 'video' ? 'is-video' : ''}" data-media-id="${m.id}">
      ${inner}
      <button class="media-edit-btn" data-media-edit="${m.id}" title="Editar">✎</button>
      ${m.is_favorite ? '<span class="photo-fav">♥</span>' : ''}
      ${albumTag}
    </div>`;
}

function renderMediaGrid(medias, { showAlbumTag = false, emptyMsg = 'Nenhuma mídia por aqui.' } = {}) {
  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  if (!medias.length) {
    grid.innerHTML = `<p style="color:var(--muted)">${emptyMsg}</p>`;
  } else {
    medias.forEach(m => grid.appendChild(el(mediaItemHtml(m, showAlbumTag))));
  }
  return grid;
}

function renderMediasView(album, medias) {
  const header = el(`
    <div class="view-header">
      <button class="btn-back" id="btn-back">← Voltar</button>
      <h2>${escapeHtml(album.name)}</h2>
      <button class="btn-ghost" id="btn-edit-album">Editar</button>
      <button class="btn-add" id="btn-add">+ Adicionar mídia</button>
    </div>
  `);
  const grid = renderMediaGrid(medias, {
    emptyMsg: 'Nenhuma mídia neste álbum. Adicione a primeira.',
  });
  viewEl.innerHTML = '';
  viewEl.appendChild(header);
  viewEl.appendChild(grid);

  document.getElementById('btn-back').addEventListener('click', () => {
    state.view = state._prevView || 'albums';
    state.albumId = null;
    render();
  });
  document.getElementById('btn-add').addEventListener('click', () => openUploadModal(album.id));
  document.getElementById('btn-edit-album').addEventListener('click', () => openAlbumEditModal(album.id));
}

function renderLooseView(medias) {
  const header = el(`
    <div class="view-header">
      <h2>Fotos soltas</h2>
      <button class="btn-add" id="btn-add">+ Adicionar</button>
    </div>
  `);
  const grid = renderMediaGrid(medias, {
    emptyMsg: 'Nenhuma mídia solta. Envie uma para começar.',
  });
  viewEl.innerHTML = '';
  viewEl.appendChild(header);
  viewEl.appendChild(grid);
  document.getElementById('btn-add').addEventListener('click', () => openUploadModal('loose'));
}

function renderFavoritesView(medias) {
  if (!medias.length) { empty('♥', 'Você ainda não favoritou nada.'); return; }
  const grid = renderMediaGrid(medias, { showAlbumTag: true });
  viewEl.innerHTML = '';
  viewEl.appendChild(grid);
}

// ---------- Configurações ----------
function renderSettingsView() {
  viewEl.innerHTML = `
    <div class="settings-panel">
      <div class="settings-section">
        <h3>Conta</h3>
        <div class="settings-row"><span>Usuário</span><strong>${escapeHtml(window.__USERNAME__ || '')}</strong></div>
        <div class="settings-row"><span>Sessão</span><button class="btn-danger" id="btn-logout-2">Sair agora</button></div>
      </div>
      <div class="settings-section">
        <h3>Preferências</h3>
        <div class="settings-row"><span>Tema</span><strong>Escuro</strong></div>
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
  searchEl.style.display = (state.view === 'photos' || state.view === 'settings') ? 'none' : '';

  if (state.view === 'albums' || state.view === 'special') {
    loading();
    try {
      const albums = await api('/api/albums').then(r => r.json());
      state.albums = albums;
      renderAlbumsView(state.view === 'special' ? albums.filter(a => a.is_special) : albums);
    } catch {}
    return;
  }
  if (state.view === 'loose') {
    loading();
    try {
      const data = await api('/api/medias/loose').then(r => r.json());
      renderLooseView(data.medias || []);
    } catch {}
    return;
  }
  if (state.view === 'favorites') {
    loading();
    try { renderFavoritesView(await api('/api/medias/favorites').then(r => r.json())); } catch {}
    return;
  }
  if (state.view === 'settings') { renderSettingsView(); return; }
  if (state.view === 'photos' && state.albumId) {
    loading();
    try {
      const data = await api(`/api/albums/${state.albumId}/medias`).then(r => r.json());
      renderMediasView(data.album, data.medias);
    } catch {}
    return;
  }
}

// ---------- Busca ----------
async function runSearch(q) {
  if (q.length < 2) return;
  loading();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    renderSearchResults(q, data);
  } catch {}
}

function renderSearchResults(q, data) {
  pageTitle.textContent = 'Busca';
  const albums = data.albums || [];
  const medias = data.medias || [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="search-heading">Resultados para <strong>${escapeHtml(q)}</strong>
    — ${albums.length} álbum(ns), ${medias.length} mídia(s)</p>`;

  if (albums.length) {
    const sec = document.createElement('section');
    sec.className = 'search-section';
    sec.innerHTML = '<h3>Álbuns</h3>';
    const grid = document.createElement('div');
    grid.className = 'albums-grid';
    albums.forEach(a => {
      const cover = a.cover_url
        ? `<img src="${escapeHtml(a.cover_url)}" alt="${escapeHtml(a.name)}" loading="lazy">`
        : `<div class="album-cover-empty"><span class="album-cover-icon">▦</span></div>`;
      grid.appendChild(el(`
        <article class="album-card" data-id="${a.id}">
          <div class="album-cover">${cover}</div>
          <div class="album-meta">
            <h3>${escapeHtml(a.name)} ${a.is_special ? '<span class="special-dot">●</span>' : ''}</h3>
            <p>${escapeHtml(a.description || 'Sem descrição')}</p>
          </div>
        </article>
      `));
    });
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }

  if (medias.length) {
    const sec = document.createElement('section');
    sec.className = 'search-section';
    sec.innerHTML = '<h3>Mídias</h3>';
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    medias.forEach(m => grid.appendChild(el(mediaItemHtml(m, true))));
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }

  if (!albums.length && !medias.length) {
    wrap.appendChild(el(`<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Nada encontrado.</p></div>`));
  }

  viewEl.innerHTML = '';
  viewEl.appendChild(wrap);
  setActiveNav(null);
}

// ---------- Upload modal ----------
let uploadTarget = null; // id ou 'loose'

function openUploadModal(target) {
  if (target === 'loose') uploadTarget = 'loose';
  else if (typeof target === 'number' || typeof target === 'string') uploadTarget = Number(target);
  else { uploadTarget = state.albumId; }
  if (!uploadTarget) return;
  if (state.upload.count >= MAX_UPLOADS_PER_SESSION) return;

  uploadModalT.textContent = (uploadTarget === 'loose') ? 'Adicionar foto solta' : 'Adicionar mídia ao álbum';

  state.upload.file = null;
  state.upload.uploading = false;
  uploadFileIn.value = '';
  uploadTitleIn.value = '';
  fileInfo.hidden = true;
  progress.hidden = true;
  progressBar.style.width = '0%';
  uploadError.textContent = '';
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Enviar';
  uploadModal.hidden = false;
  uploadTitleIn.focus();
}

function closeUploadModal() {
  if (state.upload.uploading) return;
  uploadModal.hidden = true;
  state.upload.file = null;
}

function setUploadFile(file) {
  uploadError.textContent = '';
  if (!file) { state.upload.file = null; fileInfo.hidden = true; uploadBtn.disabled = true; return; }
  if (!ALLOWED_MIMES.has(file.type)) {
    uploadError.textContent = 'Tipo não aceito. Use jpg/png/gif/webp ou mp4/webm.';
    state.upload.file = null; fileInfo.hidden = true; uploadBtn.disabled = true; return;
  }
  if (file.size > MAX_BYTES) {
    uploadError.textContent = `Arquivo muito grande (${fmtBytes(file.size)}). Máximo: 50 MB.`;
    state.upload.file = null; fileInfo.hidden = true; uploadBtn.disabled = true; return;
  }
  state.upload.file = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = fmtBytes(file.size);
  fileInfo.hidden = false;
  uploadBtn.disabled = false;
}

uploadFileIn.addEventListener('change', () => setUploadFile(uploadFileIn.files[0] || null));
uploadClose.addEventListener('click', closeUploadModal);
uploadCancel.addEventListener('click', closeUploadModal);
uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) closeUploadModal(); });

['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f) setUploadFile(f);
});

uploadBtn.addEventListener('click', async () => {
  if (!state.upload.file || state.upload.uploading || !uploadTarget) return;
  if (state.upload.count >= MAX_UPLOADS_PER_SESSION) {
    uploadError.textContent = `Limite de ${MAX_UPLOADS_PER_SESSION} uploads por sessão atingido.`;
    return;
  }
  const elapsed = Date.now() - state.upload.lastAt;
  if (state.upload.lastAt && elapsed < UPLOAD_COOLDOWN_MS) {
    uploadError.textContent = `Aguarde ${Math.ceil((UPLOAD_COOLDOWN_MS - elapsed)/1000)}s.`;
    return;
  }

  state.upload.uploading = true;
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Enviando…';
  uploadError.textContent = '';
  progress.hidden = false;
  progressBar.style.width = '0%';

  const endpoint = (uploadTarget === 'loose')
    ? '/api/medias/loose/upload'
    : `/api/albums/${uploadTarget}/upload`;

  try {
    await uploadWithProgress(
      endpoint,
      state.upload.file,
      uploadTitleIn.value.trim(),
      p => { progressBar.style.width = `${Math.round(p*100)}%`; }
    );
    state.upload.count += 1;
    state.upload.lastAt = Date.now();
    state.upload.uploading = false;
    uploadModal.hidden = true;
    render();
  } catch (err) {
    state.upload.uploading = false;
    uploadError.textContent = err.message || 'Falha no upload.';
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Enviar';
    progress.hidden = true;
  }
});

function uploadWithProgress(endpoint, file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Resposta inválida')); }
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

// ---------- Album edit modal ----------
function openAlbumEditModal(albumId) {
  const album = state.albums.find(a => a.id === albumId);
  if (!album) return;
  state.editingAlbum = album;
  albumEditName.value = album.name || '';
  albumEditDesc.value = album.description || '';
  albumEditSpec.checked = !!album.is_special;
  albumEditErr.textContent = '';
  albumEditModal.hidden = false;
}
function closeAlbumEditModal() {
  albumEditModal.hidden = true;
  state.editingAlbum = null;
}
albumEditClose.addEventListener('click', closeAlbumEditModal);
albumEditCancel.addEventListener('click', closeAlbumEditModal);
albumEditModal.addEventListener('click', e => { if (e.target === albumEditModal) closeAlbumEditModal(); });

albumEditSave.addEventListener('click', async () => {
  if (!state.editingAlbum) return;
  const name = albumEditName.value.trim();
  if (!name) { albumEditErr.textContent = 'Nome não pode ser vazio.'; return; }

  albumEditErr.textContent = '';
  albumEditSave.disabled = true;
  try {
    const res = await api(`/api/albums/${state.editingAlbum.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        description: albumEditDesc.value.trim(),
        is_special: albumEditSpec.checked,
      }),
    });
    if (!res.ok) throw new Error('Falha ao salvar.');
    closeAlbumEditModal();
    render();
  } catch (err) {
    albumEditErr.textContent = err.message || 'Falha.';
  } finally {
    albumEditSave.disabled = false;
  }
});

albumEditDelete.addEventListener('click', async () => {
  if (!state.editingAlbum) return;
  if (!confirm(`Excluir o álbum "${state.editingAlbum.name}"? As mídias dele viram soltas.`)) return;
  albumEditDelete.disabled = true;
  try {
    const res = await api(`/api/albums/${state.editingAlbum.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha.');
    closeAlbumEditModal();
    render();
  } catch (err) {
    albumEditErr.textContent = err.message || 'Falha.';
    albumEditDelete.disabled = false;
  }
});

// ---------- Media edit modal ----------
let editingMediaObj = null;

async function openMediaEditModal(mediaId) {
  let m = (state._lastMedias || []).find(x => String(x.id) === String(mediaId));
  if (!m) return;

  editingMediaObj = m;
  mediaPreview.innerHTML = '';
  if (m.type === 'video') {
    const v = document.createElement('video');
    v.src = m.url; v.controls = true; v.preload = 'metadata'; v.playsInline = true;
    mediaPreview.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = m.url; img.alt = '';
    mediaPreview.appendChild(img);
  }
  mediaEditTitle.value = m.title || '';
  mediaEditFav.checked = !!m.is_favorite;
  mediaEditErr.textContent = '';
  mediaEditReplaceI.value = '';

  if (!state.albums.length) {
    try { state.albums = await api('/api/albums').then(r => r.json()); } catch {}
  }
  mediaEditAlbum.innerHTML = '';
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = 'Sem álbum (foto solta)';
  mediaEditAlbum.appendChild(optNone);
  state.albums.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.name;
    if (a.id === m.album_id) o.selected = true;
    mediaEditAlbum.appendChild(o);
  });
  if (m.album_id == null) optNone.selected = true;

  mediaEditModal.hidden = false;
}
function closeMediaEditModal() {
  mediaEditModal.hidden = true;
  editingMediaObj = null;
  mediaEditReplaceI.value = '';
}
mediaEditClose.addEventListener('click', closeMediaEditModal);
mediaEditCancel.addEventListener('click', closeMediaEditModal);
mediaEditModal.addEventListener('click', e => { if (e.target === mediaEditModal) closeMediaEditModal(); });

mediaEditReplace.addEventListener('click', () => mediaEditReplaceI.click());

mediaEditReplaceI.addEventListener('change', async () => {
  if (!editingMediaObj) return;
  const file = mediaEditReplaceI.files[0];
  if (!file) return;
  if (!ALLOWED_MIMES.has(file.type)) { mediaEditErr.textContent = 'Tipo não aceito.'; mediaEditReplaceI.value = ''; return; }
  if (file.size > MAX_BYTES) { mediaEditErr.textContent = `Arquivo muito grande (${fmtBytes(file.size)}).`; mediaEditReplaceI.value = ''; return; }

  mediaEditErr.textContent = 'Substituindo…';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api(`/api/medias/${editingMediaObj.id}/replace`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Falha ao substituir.');
    closeMediaEditModal();
    render();
  } catch (err) {
    mediaEditErr.textContent = err.message || 'Falha.';
    mediaEditReplaceI.value = '';
  }
});

mediaEditSave.addEventListener('click', async () => {
  if (!editingMediaObj) return;
  const payload = {
    title: mediaEditTitle.value.trim(),
    is_favorite: mediaEditFav.checked,
  };
  const selAlbum = mediaEditAlbum.value;
  payload.album_id = selAlbum === '' ? null : Number(selAlbum);

  mediaEditErr.textContent = '';
  mediaEditSave.disabled = true;
  try {
    const res = await api(`/api/medias/${editingMediaObj.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Falha ao salvar.');
    closeMediaEditModal();
    render();
  } catch (err) {
    mediaEditErr.textContent = err.message || 'Falha.';
  } finally {
    mediaEditSave.disabled = false;
  }
});

mediaEditDelete.addEventListener('click', async () => {
  if (!editingMediaObj) return;
  if (!confirm('Excluir esta mídia?')) return;
  mediaEditDelete.disabled = true;
  try {
    const res = await api(`/api/medias/${editingMediaObj.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha.');
    closeMediaEditModal();
    render();
  } catch (err) {
    mediaEditErr.textContent = err.message || 'Falha.';
    mediaEditDelete.disabled = false;
  }
});

// ---------- Navegação ----------
navItems.forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    state.view = item.dataset.view;
    state.albumId = null;
    render();
  });
});

// Delegação de clicks: prioridade → editar álbum > editar mídia > lightbox > entrar no álbum
viewEl.addEventListener('click', (e) => {
  // 1. Botão de editar álbum
  const albumEditBtn = e.target.closest('[data-album-edit]');
  if (albumEditBtn) {
    e.stopPropagation();
    openAlbumEditModal(Number(albumEditBtn.dataset.albumEdit));
    return;
  }

  // 2. Botão de editar mídia
  const mediaEditBtn = e.target.closest('[data-media-edit]');
  if (mediaEditBtn) {
    e.stopPropagation();
    openMediaEditModal(Number(mediaEditBtn.dataset.mediaEdit));
    return;
  }

  // 3. Clique numa foto (não-vídeo) → abre lightbox
  const photoItem = e.target.closest('.photo-item');
  if (photoItem && !photoItem.classList.contains('is-video')) {
    const img = photoItem.querySelector('img');
    if (img && img.src) {
      openLightbox(img.src, img.alt || 'Sem título');
      return;
    }
  }

  // 4. Card de álbum → entra no álbum
  const card = e.target.closest('.album-card');
  if (card) {
    state._prevView = state.view;
    state.albumId = Number(card.dataset.id);
    state.view = 'photos';
    render();
    return;
  }
});

// ---------- Busca ----------
searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  clearTimeout(state.search.timer);
  if (q.length < 2) {
    if (state.view === 'search') {
      state.view = state.search.lastView || 'albums';
      render();
    }
    return;
  }
  if (state.view !== 'search') state.search.lastView = state.view;
  state.search.timer = setTimeout(() => runSearch(q), 220);
});

// ---------- Logout ----------
async function doLogout() {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { window.location.href = '/'; }
}
logoutBtn.addEventListener('click', doLogout);

// ---------- Init ----------
window.__USERNAME__ = document.querySelector('.user-name')?.textContent?.trim() || '';

// Cache de medias para o modal de edição
const _origRenderMedias = renderMediasView;
const _origRenderLoose = renderLooseView;
const _origRenderFav = renderFavoritesView;

renderMediasView = function (album, medias) { state._lastMedias = medias; _origRenderMedias(album, medias); };
renderLooseView  = function (medias)       { state._lastMedias = medias; _origRenderLoose(medias); };
renderFavoritesView = function (medias)    { state._lastMedias = medias; _origRenderFav(medias); };

render();