import { authenticate, HttpError } from './auth.mjs';
import { api, json } from './api.mjs';
export function privateHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!(url.pathname === '/us' || url.pathname.startsWith('/us/'))) return env.ASSETS.fetch(request);
    try {
      const me = await authenticate(request, env);
      if (url.pathname === '/us/logout' && request.method === 'GET') {
        // The app cookie is scoped to /us, so Cloudflare's root-domain logout
        // endpoint cannot receive it. Clear it here, then revoke the global session.
        const headers = new Headers({ Location: `${String(env.ACCESS_ISSUER).replace(/\/$/, '')}/cdn-cgi/access/logout` });
        const domains = url.hostname === 'www.lukastbecker.com' ? ['', '; Domain=lukastbecker.com'] : [''];
        for (const path of ['/us', '/us/', '/']) {
          for (const domain of domains) headers.append('Set-Cookie', `CF_Authorization=; Max-Age=0; Path=${path}; Secure; HttpOnly; SameSite=Lax${domain}`);
        }
        return privateHeaders(new Response(null, { status: 303, headers }));
      }
      const response = url.pathname.startsWith('/us/api/') ? await api(request, env, me) : await env.ASSETS.fetch(request);
      return privateHeaders(response);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Something went wrong. Please try again.';
      if (url.pathname.startsWith('/us/api/')) return privateHeaders(json({ error: message }, status));
      return privateHeaders(new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private space</title><body><main><h1>Private space</h1><p>${message}</p><p><a href="/">Back to the website</a></p></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    }
  },
};
