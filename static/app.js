// ---------- Login (front stub) ----------
// SEGURANÇA — leia antes de plugar o backend:
// 1. As credenciais dos 3 usuários NUNCA existem aqui. Só no backend.
// 2. O backend sempre responde a mesma mensagem para "usuário inexistente"
//    e "senha errada". Isso evita enumeração de usuários.
// 3. O backend fará hash das senhas (bcrypt/argon2) — o front nunca as vê.
// 4. Em produção, tudo sobre HTTPS.

const form    = document.getElementById('login-form');
const message = document.getElementById('form-message');

// Regex leve só para dar feedback rápido. O backend tem a palavra final.
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

function clearMessage() {
  message.textContent = '';
  message.className = 'form-message';
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = `form-message ${type}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = form.username.value.trim();
  const password = form.password.value;

  form.querySelectorAll('input').forEach(i => i.classList.remove('invalid'));
  clearMessage();

  // ---------- Validação de formato no cliente ----------
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

  // ---------- Chamada ao backend (stub por enquanto) ----------
  // TODO: trocar pelo fetch real na próxima etapa:
  //
  //   const res = await fetch('/api/auth/login', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     credentials: 'same-origin',              // cookies httpOnly
  //     body: JSON.stringify({ username, password })
  //   });
  //
  //   if (res.ok) {
  //     const data = await res.json();         // { user: {...} } — nunca senha
  //     // redirecionar para /galeria.html
  //   } else {
  //     // 401 ou 429 → mesma mensagem genérica, sem detalhar o motivo
  //     showMessage('Usuário ou senha inválidos.', 'error');
  //   }

  showMessage('Front pronto. Aguardando conexão com o backend…', 'success');
  console.log('Login (stub) — payload que irá ao backend:', { username });
});