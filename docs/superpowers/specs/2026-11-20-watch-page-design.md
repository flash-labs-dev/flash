# Watch page for shared clips: design

Date: 2026-11-20. Status: direction approved by the owner in chat ("go with B"); the page look is checked by screenshot before release.

## Intent

A shared Flash clip link should open a Flash-branded watch page, not a bare video file. Every viewer lands on a free ad: the clip plays, and a download button and the Flash name sit next to it. Medal's link pages are the reference.

## Goals

- Share links open `https://flashclipping.fyi/c/<id>`, a page with the clip playing, the Flash logo, an OS-aware download button and one line of text.
- Pasting the link in Discord, X or iMessage shows an inline video preview (Open Graph video tags).
- An expired or unknown clip shows a short "this clip is gone, get Flash" page, with a real 404/410 status, so a dead link still advertises.
- The page shows "expires in N days" computed from the clip's age, when the server gives an age.
- Old links (`share.flashclipping.fyi/c/<id>.mp4`) keep working unchanged.

## Non-goals

- Accounts, clip libraries, comments, likes, view counts. Deferred: accounts get their own round once the watch page proves useful.
- Moving clip storage off the home server (approach C, later).
- Changing the upload endpoint, the 100 MB cap, the rate limit or the 7-day expiry.

## Anti-goals

- The page must not make the home server a hard dependency for the marketing site. If the server is down, `/` still loads and `/c/<id>` shows a calm "can't load this clip right now" state.
- No tracking scripts, no third-party requests except Google Fonts (already used by the site).
- No text walls. One caption line, one button.

## Constraints

- Clip storage and upload stay on the home server behind the Cloudflare tunnel at `share.flashclipping.fyi`. Its code is not in this repo. Do not edit or deploy anything on the server.
- The site is static assets on a Cloudflare Worker (`apps/site`, `wrangler.jsonc`, project `flash-site`, custom domain `flashclipping.fyi`). The watch page is added to the same Worker.
- Clip ids match `[A-Za-z0-9_-]{12}`; the server file is `https://share.flashclipping.fyi/c/<id>.mp4`. The id is untrusted input: validate before use and never reflect anything else into HTML.
- Visual rules follow `apps/site/DESIGN.md` (tokens, outline buttons, one solid primary, red only for live state).
- The desktop link change must not ship before the Worker route is live, or new links would 404.

## Approaches considered

- A. Home server renders the page. Least new plumbing, but the page design would live on a server that is being replaced, apart from the site's look and repo.
- B. Cloudflare Worker on `flashclipping.fyi/c/*` renders the page; the server keeps the videos. Chosen. One repo and one look; no server changes; old links unaffected.
- C. Move clips to Cloudflare R2. Survives the server replacement and suits accounts, but is the largest build and rewrites the server's cap, rate limit and cleanup. Later.

## Design

**Worker.** `apps/site/worker.js` with `run_worker_first: ["/c/*"]` in `wrangler.jsonc`, so static assets are still served by the platform for everything else.

- `GET /c/<id>`: validate id; `HEAD` the mp4 at the share origin. 200 gives the watch page (status 200). 404 gives the expired page (status 410). Any other status or a network error gives the "can't load right now" page (status 503, `Cache-Control: no-store`).
- Age: if the mp4 response has `Last-Modified`, show "expires in N days" using a 7-day lifetime; otherwise omit the line.
- Page HTML is one template string in the Worker: same tokens and Antonio font as the site, `<video controls autoplay muted loop playsinline preload="metadata">` pointing at the share origin mp4, Open Graph and Twitter tags (`og:type video.other`, `og:video`, `og:video:type video/mp4`, `og:title`, `og:image` = site og.jpg, `twitter:card player`), `robots noindex`.
- Download button: reuses the site's OS detection and GitHub release lookup (small inline script, same behaviour: phones get a link to `/#get`).
- `GET /c/<id>.mp4` from the new origin redirects (302) to the share origin file, so a user who edits the link still works.
- Anything else under `/c/` is a 404.

**Desktop app.** `shareUrlFromPath` keeps accepting only `/c/<12 chars>.mp4` from the server, but returns `https://flashclipping.fyi/c/<id>` (no `.mp4`). Tests updated. Ships in the next beta, after the Worker is deployed and checked.

## Left to the builder

Exact page layout within the sketch below, copy wording within the "one line" rule, test structure.

```
[ FLASH ]                         [ Download for Windows ]
+------------------------------------------+
|           clip plays here, autoplay       |
+------------------------------------------+
 Rocket League · expires in 5 days
 Never miss the clip.
```
