import { HttpError, members } from './auth.mjs';

const COOKIE = '__Host-us_session';
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const unavailable = () => new HttpError(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
const denied = () => new HttpError(401, 'Please check your email and password and try again.');
const expired = () => new HttpError(401, 'Please sign in again.');
const base64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export const passwordMode = env => env.AUTH_MODE === 'firebase';

function configuration(env) {
  members(env);
  if (!env.US_DB || !/^[A-Za-z0-9_-]{20,200}$/.test(env.FIREBASE_API_KEY || '')
    || !/^[a-z0-9-]{6,63}$/.test(env.FIREBASE_PROJECT_ID || '')
    || !/^[a-f0-9]{64}$/.test(env.SESSION_ENCRYPTION_KEY || '')) throw unavailable();
}
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
async function encryptionKey(env) {
  return crypto.subtle.importKey('raw', Uint8Array.from(env.SESSION_ENCRYPTION_KEY.match(/../g), b => parseInt(b, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await encryptionKey(env), encoder.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
async function decrypt(env, value, context) {
  const [iv, ciphertext] = value.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(context) }, await encryptionKey(env), bytes(ciphertext))));
}
function sessionCookie(value, seconds) {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax${seconds === undefined ? '' : `; Max-Age=${seconds}`}`;
}
export const clearSessionCookie = () => sessionCookie('', 0);
async function sessionHash(request) {
  const value = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? hash(value) : null;
}
async function firebase(env, operation, payload) {
  const refresh = operation === 'refresh';
  const url = refresh ? 'https://securetoken.googleapis.com/v1/token' : `https://identitytoolkit.googleapis.com/v1/accounts:${operation}`;
  let response;
  try {
    response = await fetch(`${url}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': refresh ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: refresh ? new URLSearchParams(payload).toString() : JSON.stringify(payload),
    });
  } catch { throw unavailable(); }
  let result;
  try { result = await response.json(); } catch { throw unavailable(); }
  if (!response.ok) {
    if (response.status >= 500) throw unavailable();
    const code = String(result.error?.message || '').split(' : ')[0];
    const error = denied(); error.providerCode = code;
    if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || response.status === 429) {
      error.status = 429; error.message = 'Too many attempts. Please wait a little before trying again.';
    }
    if (['OPERATION_NOT_ALLOWED', 'API_KEY_INVALID', 'CONFIGURATION_NOT_FOUND'].includes(code)) throw unavailable();
    throw error;
  }
  return result;
}
async function account(env, token) {
  const result = await firebase(env, 'lookup', { idToken: token });
  const user = result.users?.[0];
  if (!user || user.disabled || !user.localId || !user.emailVerified
    || !members(env).includes(String(user.email).toLowerCase())) throw expired();
  return user;
}
async function limitAttempts(request, env, email) {
  const time = now(), window = Math.floor(time / 900);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // Fixed-window, atomic counters live in D1, so retries across Worker instances count too.
  for (const [subject, maximum] of [[`ip:${ip}`, 25], [`email:${email}`, 12]]) {
    const key = `${window}:${await hash(subject)}`;
    const row = await env.US_DB.prepare(`INSERT INTO auth_attempts (key, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, (window + 1) * 900).first();
    if (row.count > maximum) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes before trying again.');
  }
  await env.US_DB.prepare('DELETE FROM auth_attempts WHERE expires_at < ?').bind(time).run();
  await env.US_DB.prepare('DELETE FROM password_sessions WHERE expires_at < ?').bind(time).run();
}
async function input(request) {
  if (request.method !== 'POST') throw new HttpError(405, 'Use the sign-in form.');
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'Please use the form on this website.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use the sign-in form.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Please complete the form.');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); throw new HttpError(413, 'This request is too long.'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try {
    const result = JSON.parse(new TextDecoder().decode(buffer));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Please complete the form.'); }
}
async function createSession(request, env, result, remember) {
  const user = await account(env, result.idToken);
  if (user.localId !== result.localId || user.email.toLowerCase() !== result.email.toLowerCase()) throw denied();
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const id = await hash(raw), time = now(), duration = remember ? 30 * 86400 : 86400;
  const tokens = await encrypt(env, { idToken: result.idToken, refreshToken: result.refreshToken }, id);
  await env.US_DB.prepare(`INSERT INTO password_sessions (id_hash, uid, email, tokens, token_expires_at, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, user.localId, user.email.toLowerCase(), tokens, time + Math.min(Number(result.expiresIn) || 3600, 3600), time, time + duration).run();
  const old = await sessionHash(request);
  if (old) await env.US_DB.prepare('DELETE FROM password_sessions WHERE id_hash = ?').bind(old).run();
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(raw, remember ? duration : undefined) } });
}

export async function passwordEndpoints(request, env) {
  configuration(env);
  const action = new URL(request.url).pathname.split('/').pop();
  const data = await input(request);
  if (action === 'logout') {
    const id = await sessionHash(request);
    if (id) await env.US_DB.prepare('DELETE FROM password_sessions WHERE id_hash = ?').bind(id).run();
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
  }
  if (!['login', 'register', 'reset', 'verify'].includes(action)) throw new HttpError(404, 'Not found.');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter your email address.');
  await limitAttempts(request, env, email);
  const allowed = members(env).includes(email);
  if (action === 'reset') {
    if (allowed) {
      try { await firebase(env, 'sendOobCode', { requestType: 'PASSWORD_RESET', email, continueUrl: 'https://lukastbecker.com/us/login/' }); }
      catch (error) { if (error.providerCode !== 'EMAIL_NOT_FOUND') throw error; }
    }
    return Response.json({ message: 'If this email has an account here, a password-reset link is on its way. Check your spam folder too.' });
  }
  if (!allowed) throw denied();
  const password = typeof data.password === 'string' ? data.password : '';
  if (!password || password.length > 256) throw new HttpError(400, 'Enter your password (up to 256 characters).');
  if (action === 'register' && password.length < 12) throw new HttpError(400, 'Choose a password with at least 12 characters. A few memorable words work well.');
  let result;
  try { result = await firebase(env, action === 'register' ? 'signUp' : 'signInWithPassword', { email, password, returnSecureToken: true }); }
  catch (error) {
    if (action === 'register' && error.providerCode === 'EMAIL_EXISTS') throw new HttpError(400, 'An account already exists. Sign in or use Forgot password.');
    if (error.providerCode === 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS') throw new HttpError(400, 'Please choose a longer, stronger password.');
    throw error;
  }
  if (action === 'register' || action === 'verify') {
    await firebase(env, 'sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: result.idToken, continueUrl: 'https://lukastbecker.com/us/login/' });
    return Response.json({ message: 'Check your email for a verification link. Open it once, then come back here to sign in with your password.' });
  }
  const lookup = await firebase(env, 'lookup', { idToken: result.idToken });
  if (lookup.users?.[0]?.emailVerified !== true) {
    return Response.json({ error: 'Please verify your email first. You can resend the link below.', needsVerification: true }, { status: 403 });
  }
  return createSession(request, env, result, data.remember === true);
}

export async function authenticatePassword(request, env) {
  configuration(env);
  const id = await sessionHash(request);
  if (!id) throw expired();
  const row = await env.US_DB.prepare('SELECT * FROM password_sessions WHERE id_hash = ?').bind(id).first();
  if (!row || row.expires_at <= now() || !members(env).includes(row.email)) throw expired();
  try {
    let tokens = await decrypt(env, row.tokens, id);
    if (row.token_expires_at <= now() + 60) {
      const fresh = await firebase(env, 'refresh', { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      if (fresh.user_id !== row.uid || !fresh.id_token || !fresh.refresh_token) throw expired();
      tokens = { idToken: fresh.id_token, refreshToken: fresh.refresh_token };
      // No expiry extension: Remember me is an absolute maximum of 30 days.
      await env.US_DB.prepare('UPDATE password_sessions SET tokens = ?, token_expires_at = ? WHERE id_hash = ? AND tokens = ?')
        .bind(await encrypt(env, tokens, id), now() + Math.min(Number(fresh.expires_in) || 3600, 3600), id, row.tokens).run();
    }
    // Online lookup detects disabled/deleted users and changed emails immediately.
    const user = await account(env, tokens.idToken);
    if (user.localId !== row.uid || user.email.toLowerCase() !== row.email || Number(user.validSince || 0) > row.created_at) throw expired();
    // A concurrent logout must not be undone by an in-flight refresh.
    if (!(await env.US_DB.prepare('SELECT id_hash FROM password_sessions WHERE id_hash = ?').bind(id).first())) throw expired();
    return row.email;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 503 || error.status === 429)) throw error;
    await env.US_DB.prepare('DELETE FROM password_sessions WHERE id_hash = ?').bind(id).run();
    throw expired();
  }
}
