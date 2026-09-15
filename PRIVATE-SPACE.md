# Just us

An unlisted `/us/` page for two people, added alongside the existing Astro homepage.

## What is implemented

- Open-when letters: write drafts, reopen and edit drafts, seal and share, read, and record the first opening. Drafts are visible only to their author. Shared letters are immutable in this first version.
- One shared, persistent two-player tile-rummy table. Players join from separate devices, take turns, rearrange sets, draw, finish a match, and start a rematch. The browser refreshes the table every five seconds while it is visible. Each accepted turn is saved; unfinished moves remain in memory on that screen.
- House rules: 104 numbered tiles, no jokers or timer, a 30-point initial meld, runs/groups, and lowest remaining total if both players pass after the pile empties. This is a first tile-rummy variant, not the full Rummikub ruleset.
- A Cloudflare Worker checks the Access JWT signature, issuer, audience, expiry, application token type, and two-email allowlist before serving the private route or its API.
- D1 stores letters and games. Neither is embedded in the HTML, JavaScript, repository, or browser local storage. Server responses omit opponents' racks and the draw pile. Saved versions prevent stale edits or turns from overwriting newer ones.

## Current deployment status

Deployed at **https://lukastbecker.com/us/** on the existing `personal-website` Cloudflare Worker. Cloudflare Access protects the private path on both the apex and `www` domains. The `US_DB` binding stores letters and saved games in the `just-us` D1 database. The access list and token-verification settings are Worker secrets.

`wrangler.jsonc` is the actual deployment configuration. It contains resource identifiers and public domains, but no credentials or private email list. The GitHub repository remains public at the owner's request. `wrangler.us.example.jsonc` is a reusable setup reference, not the active configuration.

The existing homepage and its navigation are unchanged; `/us/` is reached by a bookmark or direct URL. Hiding the link and excluding search engines are conveniences. Access verification and authorization protect the data.

## Local review

Node.js 22.13+ is needed for the disposable SQLite preview and tests (the installed Node 26 works).

1. `npm run build`
2. `npm run test:us`
3. `npm run preview:us`
4. Open `http://127.0.0.1:4321/us/` in your browser.

The preview uses **sample accounts and an in-memory database**, binds only to `127.0.0.1`, validates its Host header, and is not part of the production Worker. The yellow banner switches between the two sample people. Start a game as one person, switch to the other and join, then switch back to take a turn. Write a draft, switch accounts to verify it is invisible, switch back to share it, and open it from the other account.

Do not use real personal letters in this preview. All preview data disappears when it stops. Standard `npm run dev` serves only the static shell; the API is not available through Astro alone.

## Deployment and maintenance

The existing GitHub integration builds `main` with `npm run build` and deploys with `npx wrangler deploy`. The checked-in `wrangler.jsonc` makes future builds include the server entry point, protected-path routing, existing public domains, and database binding. Keep this configuration with the source when pushing updates.

For a manual deployment from this folder, run `npm run build`, `npm run test:us`, and `npx wrangler deploy`. Use the existing Cloudflare account. Apply new database migrations with `npx wrangler d1 migrations apply just-us --remote` after reviewing them. Existing Worker secrets are retained across deployments; never replace them with public build variables.

The following records how the private infrastructure is configured, and how to recreate it if needed.

Use the existing Worker and domain. Inspect its current settings before merging the example so existing routes and bindings are retained.

1. Create a D1 database for this space, bind it as `US_DB`, and apply `migrations/0001_us.sql`. Keep development/preview databases separate from production.
2. In Cloudflare Zero Trust, create a self-hosted Access application covering **both** `lukastbecker.com/us` and `lukastbecker.com/us/*`. Cover any other hostname that serves this path, including `www` if used. Use an Allow policy for exactly the two email addresses supplied privately by the owner. Enable email one-time PIN if appropriate. Do not use an Everyone or Bypass policy.
3. Save the Access team origin as the Worker secret `ACCESS_ISSUER` (format: `https://TEAM.cloudflareaccess.com`), the application's audience tag as `ACCESS_AUD`, and the two comma-separated email addresses as `ACCESS_ALLOWED_EMAILS`. Do not put their actual values in tracked configuration or source.
4. Use the checked-in `wrangler.jsonc`: the entry point is `server/worker.mjs`, the Astro `dist` directory is bound as `ASSETS`, and `assets.run_worker_first` is `["/us", "/us/*"]`. This is essential: static assets must not bypass the Worker on those paths. Both current custom domains are retained.
5. Build and deploy using that configuration. Never upload personal content or secret values to GitHub. If a future change uses a separate preview environment, give it a separate database and access policy.
6. Protect or disable the Worker's `workers.dev` and preview URLs as applicable. The Worker independently rejects requests without a valid Access token, including requests to these alternate hostnames. A plain static deployment will not have this protection and must not be represented as private.

### Online checks

- In a signed-out browser, `/us`, `/us/`, `/us/index.html`, and `/us/api/letters` require sign-in or deny access. Test alternate hostnames and preview URLs too.
- Both allowed people can sign in. An unrelated account is denied.
- A draft cannot be fetched by the other person, even if its ID is known. Shared letters are readable by the recipient; opening updates its status.
- Two separate browser sessions can join and play a game, and refreshing or reopening preserves completed turns. Opponent racks do not appear in network responses.
- Sign out and confirm protected requests are denied. The public homepage still loads signed out.

## GitHub visibility

The existing repository is public. If these changes are pushed there, the feature's existence, route, layout, and code will be visible. GitHub does not provide private individual files inside a public repository. The actual letters and game data stay in D1; access-list values stay in Worker secrets.

To hide the implementation too, make the repository private or move the private application into a separate private repository and connect it to its own Worker. Review Cloudflare's GitHub permissions and build configuration when doing that. Changing visibility does not remove copies others may already have made.

## Verification

`npm run test:us` covers draft ownership, sharing/opening, stale edits, request-origin checks, hidden game state, stale moves, set validation, first melds, board preservation, winning, and fail-closed Access validation using real RSA signatures. The Astro production build also passes. Browser checks confirmed drafting, author-only draft visibility, editing and sharing, recipient reading and opened status, game creation/joining, tile selection and movement, rejected invalid plays, resetting the rack, drawing, and advancing the turn. The narrow browser layout was visually checked without horizontal overflow; a requested phone-width override was not honored by the preview browser, so an actual phone check remains advisable.

Live signed-out checks confirm the public homepage returns 200, private paths on both custom domains redirect to Access, and private paths on the alternate `workers.dev` hostname return 401 with `private, no-store`. The app is hidden from the Access App Launcher. Email one-time PIN is enabled, with an Allow policy for exactly the two privately supplied email addresses. Cloudflare Zero Trust Free was activated by the owner. A live allowed-email sign-in successfully loaded the letter box and saved-game endpoint. Sign-out was verified to clear the session and require sign-in again. Two-person game behavior was checked using the disposable local sample accounts without placing sample letters or games into the live database.

## Adding more later

The private page uses `src/pages/us/index.astro`, styles in `src/styles/us.css`, and browser behavior in `src/scripts/us.ts`. Server authorization lives in `server/auth.mjs`; API endpoints in `server/api.mjs`; game rules in `server/game.mjs`. Add new database tables through new migrations. Keep all private reads/writes behind the same Worker authorization, and validate any new actions on the server.

References: [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Worker assets and routing](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
