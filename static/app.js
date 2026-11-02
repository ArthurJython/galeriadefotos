// ---------- Mosaico diagonal infinito (só na página de login) ----------
(function buildMosaic() {
  const mosaic = document.getElementById('photo-mosaic');
  if (!mosaic) return;

  // Padrão base 2×2 (4 fotos diferentes)
  const pattern = [
    ['travel-a', 'travel-b'],
    ['travel-c', 'travel-d'],
  ];

  // Gradientes de fallback (aparecem enquanto a foto carrega,
  // ou para sempre se ela falhar — o layout funciona do mesmo jeito)
  const gradients = [
    'linear-gradient(135deg, #f4a261 0%, #e76f51 100%)',
    'linear-gradient(135deg, #2a9d8f 0%, #e9c46a 100%)',
    'linear-gradient(135deg, #e76f51 0%, #2a9d8f 100%)',
    'linear-gradient(135deg, #e9c46a 0%, #f4a261 100%)',
  ];

  let gi = 0;
  // Tile 2× em cada direção → grid final 4×4 (16 fotos)
  for (let ry = 0; ry < 2; ry++) {
    for (const row of pattern) {
      for (let rx = 0; rx < 2; rx++) {
        for (const seed of row) {
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'eager';
          img.decoding = 'async';
          img.style.background = gradients[gi % gradients.length];
          gi += 1;
          img.addEventListener('error', () => { img.removeAttribute('src'); });
          img.src = `https://picsum.photos/seed/${seed}/800/600`;
          mosaic.appendChild(img);
        }
      }
    }
  }
})();

// ---------- Login ----------
const form    = document.getElementById('login-form');
const message = document.getElementById('form-message');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const LOGIN_COOLDOWN_MS = 2000;
let lastAttemptAt = 0;

function clearMessage() {
  message.textContent = '';
  message.className = 'form-message';
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = `form-message ${type}`;
}

function failLogin(text) {
  showMessage(text, 'error');
  form.password.value = '';
  form.password.focus();
  lastAttemptAt = Date.now();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const now = Date.now();
  const elapsed = now - lastAttemptAt;
  if (lastAttemptAt && elapsed < LOGIN_COOLDOWN_MS) {
    const wait = Math.ceil((LOGIN_COOLDOWN_MS - elapsed) / 1000);
    showMessage(`Aguarde ${wait}s antes de tentar novamente.`, 'error');
    return;
  }

  const username = form.username.value.trim();
  const password = form.password.value;

  form.querySelectorAll('input').forEach(i => i.classList.remove('invalid'));
  clearMessage();

  let valid = true;
  if (!USERNAME_RE.test(username)) {
    form.username.classList.add('invalid');
    valid = false;
  }
  if (!password || password.length < 6) {
    form.password.classList.add('invalid');
    valid = false;
  }

  if (!valid) {
    showMessage('Verifique os campos destacados.', 'error');
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const name = data.username || 'usuário';
      showMessage(`Bem-vindo, ${name}!`, 'success');
      setTimeout(() => {
        window.location.href = '/galeria';
      }, 700);
    } else if (res.status === 429) {
      failLogin('Muitas tentativas. Aguarde um instante e tente novamente.');
    } else {
      failLogin('Usuário ou senha inválidos.');
    }
  } catch (err) {
    showMessage('Não foi possível conectar ao servidor.', 'error');
  } finally {
    btn.disabled = false;
  }
});