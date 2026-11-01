const form    = document.getElementById('login-form');
const message = document.getElementById('form-message');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

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
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

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