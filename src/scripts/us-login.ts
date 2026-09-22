const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = el<HTMLFormElement>('login-form');
const password = el<HTMLInputElement>('password');
let mode: 'login' | 'register' | 'reset' = 'login';
let pending = false;
function message(text: string, error = false) {
  const box = el('login-message'); box.textContent = text; box.dataset.error = String(error);
  if (text) box.focus();
}
function setMode(next: typeof mode) {
  if (pending) return;
  mode = next; message(''); el('resend-verification').hidden = true;
  el('login-title').textContent = mode === 'login' ? 'Come on in.' : mode === 'register' ? 'Make yourself at home.' : 'Let’s get you back in.';
  el('login-description').textContent = mode === 'login' ? 'Sign in to our little corner of the world.' : mode === 'register' ? 'Choose your password. We’ll verify your email just once.' : 'We’ll email you a link to choose a new password.';
  el('login-submit').textContent = mode === 'login' ? 'Sign in' : mode === 'register' ? 'Set up my password' : 'Send reset link';
  password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  password.minLength = mode === 'register' ? 12 : 1;
  password.required = mode !== 'reset'; password.disabled = mode === 'reset';
  el('password-field').hidden = mode === 'reset'; el('password-help').hidden = mode !== 'register';
  el('remember-label').hidden = mode !== 'login';
  el('forgot-password').hidden = mode !== 'login'; el('create-account').hidden = mode !== 'login'; el('back-to-login').hidden = mode === 'login';
  form.action = `/us/auth/${mode}`;
}
el('forgot-password').onclick = () => setMode('reset');
el('create-account').onclick = () => setMode('register');
el('back-to-login').onclick = () => setMode('login');
el('show-password').onclick = () => {
  const show = password.type === 'password'; password.type = show ? 'text' : 'password';
  el('show-password').textContent = show ? 'Hide' : 'Show';
  el('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  el('show-password').setAttribute('aria-pressed', String(show));
};
async function submit(action: string) {
  if (pending || !form.reportValidity()) return;
  pending = true; message('');
  const buttons = document.querySelectorAll<HTMLButtonElement>('button'); buttons.forEach(b => b.disabled = true);
  try {
    const response = await fetch(`/us/auth/${action}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: el<HTMLInputElement>('email').value, password: action === 'reset' ? undefined : password.value, remember: el<HTMLInputElement>('remember').checked }),
    });
    const result = await response.json();
    if (!response.ok) {
      el('resend-verification').hidden = !result.needsVerification;
      throw new Error(result.error || 'Could not sign in. Please try again.');
    }
    if (action === 'login') { window.location.replace('/us/'); return; }
    password.value = ''; el('resend-verification').hidden = true;
    message(result.message || 'Done.');
  } catch (error) { message(error instanceof Error && !/fetch|JSON|Unexpected token/i.test(error.message) ? error.message : 'Could not connect. Please try again in a moment.', true); }
  finally { pending = false; buttons.forEach(b => b.disabled = false); }
}
form.onsubmit = event => { event.preventDefault(); void submit(mode); };
el('resend-verification').onclick = () => void submit('verify');
