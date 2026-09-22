# Just us

A private `/us/` space alongside the existing Astro homepage, with open-when letters and a shared two-player tile-rummy table.

## Password sign-in

The Worker uses Firebase Authentication when `AUTH_MODE` is `firebase` in `wrangler.jsonc`. The login page at `/us/login/` supports email/password autofill, first-time password setup, email verification, password-reset emails, and a 30-day Remember me option. Only the two email addresses configured in the private `ACCESS_ALLOWED_EMAILS` secret are admitted. Both users must verify their email before any private data is accessible. The existing letter/game ownership continues to use those same email addresses.

Firebase handles password storage and verification. Passwords are never persisted by the Worker or placed in GitHub. The browser receives a random, host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie; only its SHA-256 hash is stored in D1. Firebase tokens are encrypted with AES-GCM under `SESSION_ENCRYPTION_KEY`, with the session hash bound as authenticated context. Tokens stay on the server. No authentication tokens or personal content go in browser local storage.

Remembered sessions have an absolute 30-day limit. Without Remember me, the cookie is a browser-session cookie with a server-side 24-hour limit. Firebase tokens refresh automatically while the session remains valid. Online account checks reject disabled/deleted users, changed emails and revoked passwords. Temporary provider failures deny access without unnecessarily deleting a valid session. Sign-out deletes the server session immediately. Visiting `www.lukastbecker.com/us/` redirects to the apex domain to keep one consistent login.

## Features

- Letters: author-only drafts, editing drafts, sealing/sharing, recipient reading, and first-open status. Shared letters are immutable in this version.
- Tile rummy: one persistent two-player table, joining from separate devices, saved turns, table rearrangements and rematches. The visible game refreshes every five seconds. Unsubmitted moves remain only on the current screen.
- House rules: 104 numbered tiles, no jokers or timer, 30-point initial meld, runs/groups, and lowest remaining total after both players pass with an empty pile. This is not the full Rummikub ruleset.
- Each private API validates authorization and request origin. Responses omit the opponent's rack and the draw pile; saved versions prevent stale turns/edits from overwriting newer ones.

## Hosting and private settings

The existing `personal-website` Cloudflare Worker serves `lukastbecker.com` and `www.lukastbecker.com`. The `US_DB` binding is the existing `just-us` D1 database. Letters and games remain there. `migrations/0002_password_sessions.sql` adds separate session and login-attempt tables without modifying the content tables.

Runtime secrets:

- `ACCESS_ALLOWED_EMAILS`: exactly two comma-separated email addresses.
- `FIREBASE_API_KEY`: the Firebase project's web API key, held on the server for this integration.
- `FIREBASE_PROJECT_ID`: the Firebase project ID.
- `SESSION_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters. Keep this stable across deployments; changing it signs everyone out.

The old `ACCESS_ISSUER` and `ACCESS_AUD` secrets may be retained for rollback. They are ignored in Firebase mode. Missing Firebase configuration fails closed and does not silently fall back to the old sign-in method.

Firebase settings: Email/Password enabled; passwordless email-link sign-in disabled; `lukastbecker.com` authorized for email-action return links; password policy requires 12–256 characters. Verification and reset emails use Firebase's hosted action pages, then return to `/us/login/`. Users choose their own passwords through the site. Never create or put their passwords in code, command history, or setup documentation.

## Deployment

The existing GitHub integration builds `main` with `npm run build` and deploys using `npx wrangler deploy`. Keep the checked-in `wrangler.jsonc`, including `AUTH_MODE`, `server/worker.mjs`, `ASSETS`, `US_DB`, and `assets.run_worker_first: ["/us", "/us/*"]`.

For manual updates:

1. Run `npm run test:us` and `npm run build`.
2. Review and apply new migrations with `npx wrangler d1 migrations apply just-us --remote`.
3. Keep existing runtime secrets and deploy with `npx wrangler deploy`.
4. Verify signed-out HTML redirects to `/us/login/`, private APIs return 401, login succeeds only for verified allowed users, and sign-out revokes the session.

The old Cloudflare Access application is retained as `Just us — legacy Access` on `/us-legacy-access` on both domains for rollback. The active `/us` paths now open the password login directly. The Worker is the authorization boundary in Firebase mode, including on alternate Worker URLs. Do not roll back to a plain static site. To restore legacy Access mode, restore the Cloudflare Access policies before setting `AUTH_MODE` away from `firebase`.

## Local review and tests

Requires Node.js 22.13+ for the disposable SQLite adapter (installed Node 26 works).

- `npm run build`
- `npm run test:us`
- `npm run preview:us`, then open `http://127.0.0.1:4321/us/` or `/us/login/`.

The preview uses sample people and an in-memory database, binds only to `127.0.0.1`, validates its Host header, and is never imported by the production Worker. Previewing `/us/login/` shows the page; password endpoints are tested separately with a mocked Firebase service and the production Worker handler. Do not enter real passwords in the local sample preview. Standard Astro dev serves the static shell, without the private API.

Tests cover private letter ownership, sharing/opening, stale edits/turns, hidden game state, valid sets, first melds, board preservation and wins. Password tests cover opaque/encrypted remembered sessions, browser-session cookies, token refresh without extending expiry, sign-out revocation, unverified/unknown users, request origins, rate limiting, disabled accounts, changed emails, revocation, temporary outages, canonical domain routing and fail-closed configuration. The original Access signature-validation tests remain for rollback support. The build also checks that every private-page script is external and compatible with the production Content Security Policy; `vite.build.assetsInlineLimit: 0` prevents automatic script inlining.

Live verification requires each person to create their own password, verify their email once, then sign in. A real 30-day elapsed-time test is not practical during setup; session expiry and refresh behavior are exercised with controlled tests.

## GitHub visibility and future additions

The repository remains public at the owner's request. The feature's code, route and appearance are visible there; letters, games, session data, access-list values and secret keys are excluded. The page is unlisted in public navigation and marked noindex; those conveniences do not replace authorization.

Private page: `src/pages/us/index.astro`. Login: `src/pages/us/login.astro`, `src/scripts/us-login.ts`, `src/styles/us-login.css`. Password authentication: `server/password-auth.mjs`. Worker routing: `server/worker.mjs`. Private API: `server/api.mjs`. Game rules: `server/game.mjs`. Add new tables with new migrations, and keep every private read/write behind the same authorization checks.

References: [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth), [Worker assets and routing](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
