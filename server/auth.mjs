const jwksCache = new Map();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function members(env) {
  const allowed = String(env.ACCESS_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length !== 2 || new Set(allowed).size !== 2 || allowed.some(s => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) {
    throw new HttpError(503, 'This space is still being set up.');
  }
  return allowed;
}
function decode(value) {
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return bytes;
}
export async function authenticate(request, env) {
  const allowed = members(env);
  const issuer = String(env.ACCESS_ISSUER || '').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !env.ACCESS_AUD) {
    throw new HttpError(503, 'This space is still being set up.');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'Sign in to open this space.');
  try {
    if (token.length > 16384) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error();
    let cached = jwksCache.get(issuer);
    if (!cached || cached.until < Date.now()) {
      const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      cached = { keys: (await response.json()).keys, until: Date.now() + 300000 };
      jwksCache.set(issuer, cached);
    }
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Date.now() / 1000;
    if (!valid || claims.iss !== issuer || !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD)
      || typeof claims.exp !== 'number' || claims.exp <= now || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now))
      || typeof claims.sub !== 'string' || !claims.sub || claims.type !== 'app'
      || typeof claims.email !== 'string') throw new Error();
    const email = claims.email.toLowerCase();
    if (!allowed.includes(email)) throw new HttpError(403, 'This space is just for its two people.');
    return email;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Your sign-in has expired. Sign in again.');
  }
}
