# Flash site: design contract

Marketing and download pages for flashclipping.fyi. Static HTML, no build step, no dependencies. It extends the app's design language in `apps/desktop/DESIGN.md`; where the two differ, the app wins.

## Principles

1. Pictures first. Real clips carry the page; text is a caption, never a paragraph. No section needs more than a few words.
2. Never explain what a clipper is. The reader already clips. Speak like a founder in that scene.
3. Every clip looks intentional. Rocket League clips end on a goal explosion or a SAVE popup. Minecraft clips end on the Victory or Round Won result after a kill. No random mid-game footage.
4. Our own footage only: the owner's Rocket League and Minecraft clips. Nothing scraped from the web.
5. Flash red marks live or engaged state only (REC dot, step numbers). Buttons are outline, with one solid bone-white primary per view.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ground` | `#0a0a0b` | page background |
| `--panel` | `#121316` | cards |
| `--edge` / `--edge-soft` | `#2a2d34` / `#202228` | borders |
| `--bone` | `#f2f3f5` | text, primary button |
| `--ash` | `#9aa0ab` | secondary text |
| `--red` | `#e8192c` | live state only |
| `--live` | `#4ade80` | status dot, saved tick |

Type: Antonio (display, uppercase, tight leading) from Google Fonts with Bahnschrift/Arial Narrow fallbacks; Segoe UI / system UI for body. Labels are 11px, 600 weight, 0.14em tracking, uppercase.

## Homepage structure and motion

The page moves from a full-bleed clip hero and four-cell trust strip into the app, sharing, clip wall, FAQ, downloads, and footer. The app section presents Press, Trim, and Share as one accessible tabbed window rather than three separate cards. Sharing is shown twice in sequence: first as a Discord embed, then as the Flash watch page it opens. The clip wall can be filtered by game; its first visible tile is always the featured tile.

The fixed navigation begins transparent over the hero. After the visitor scrolls, it gains a blurred ground-color surface and border, and its Download button appears. The link order is App, Share, Clips, FAQ, Updates, then Download.

Reveals are short, one-time upward entrances and the hero uses only slight scroll parallax. The app tabs may rotate while idle, but direct interaction takes control. Reveals, parallax, autoplay, CSS animation, and tab auto-rotation are disabled under `prefers-reduced-motion`; content remains visible without JavaScript.

## Behaviour

- Download links default to the current release asset URLs in the HTML so the page works with no JavaScript. A script then reads the GitHub releases list (pre-releases included, since there is no stable release yet) and updates asset URLs, sizes and version text. If the request fails the static values stay.
- Videos are muted, looped, `playsinline`, with a poster frame. They play only while on screen. With `prefers-reduced-motion` they stay on the poster and the CSS animations stop.
- Only the hero preloads metadata on first load. Other videos begin with `preload="none"`; they load when observed in view. Wall tiles play on hover for pointer devices and while in view on touch devices.
- Reveal motion is a short upward entrance used once per content group. The hero clip has restrained scroll parallax. App tabs rotate automatically only until the visitor chooses one. All reveal, parallax, autoplay, CSS animation, and tab auto-rotation behavior is disabled under `prefers-reduced-motion`.
- Layout collapses at 860px: nav text links except Updates hide, the share demo and download cards stack, and the wall becomes two columns. The featured wall tile spans both columns. Phones use 20px side gutters and must not scroll horizontally.

## Footage rules

- 4 s tiles at 640px wide; hero 9 s at 1280px. H.264, no audio, `+faststart`.
- Minecraft clips have the bottom-left kill feed pixelated. Opponent nametags can still show in-world; re-check this before adding new Minecraft footage.
- No private information in frame: no Discord windows, desktop, or account names.

## Hosting

Cloudflare Workers static assets, root directory `apps/site`, no build command. `share.flashclipping.fyi` stays on the existing tunnel and is not touched by the site.

## Watch page `/c/<id>`

Shared links open a Flash-branded watch page with a logo and OS-aware download button in the navigation. The large 16:9 player is sized from the viewport height, with its title, optional expiry pill, copy action, and save action immediately underneath. A tap-for-sound control overlays the top-left of muted autoplay video, clear of the native player controls, until the viewer unmutes it. On larger non-phone screens, a blurred copy of the clip may provide a resilient ambient glow behind the page.

A horizontal CTA band sits below the player. It combines the animated F8 keycap, “Clip your own.” message, three short product checks, and a second OS-aware download button. Below 760px it stacks into a touch-friendly column, the download button becomes full width, and the player and metadata row use all available width without horizontal scrolling. Expired clips and temporary server failures use the same navigation and CTA shell, with an empty FLASH panel and the existing short status message but no video controls or clip actions.

The page uses the shared Flash color and type tokens; green appears only in the expiry status dot. Focus-visible outlines cover interactive controls. Reduced-motion preference disables the keycap animation and prevents the ambient video glow from being created. The page contains no tracking.

## Launch card (open in Flash)

Approved 2026-11-21. On desktop browsers only, the watch page tries to open the Flash app with `flash://c/<id>` and shows a centered card over a dimmed, blurred page: Flash logo, "Opening in Flash..." heading (Antonio, uppercase), the line "Launching your Flash app to watch this clip. Feel free to close this tab, or keep watching here.", a thin animated progress bar, an "Always watch in browser" checkbox, and a full-width "Watch here" button (bone fill, dark text).

- Phones and tablets (touch-primary, coarse pointer, or mobile user agent) never get the card and never attempt the launch; there is no mobile app.
- The card dismisses itself after 5 seconds, and "Watch here" or Escape dismisses it sooner. The player underneath is never blocked after dismissal.
- If the app is not installed nothing visible fails: the card simply times out into the normal web player.
- "Always watch in browser" is stored in localStorage (wrapped in try/catch) and skips both the launch attempt and the card on later visits.
- Expired and unavailable states never show the card or try to launch.
- Reduced motion makes the progress bar static.
- Card is role="dialog" with focus on "Watch here"; no tracking.

## Out of scope for now

Feedback widget, signed installers, auto-update messaging.

## Updates page

`changelog.html` is a static, newest-first list of releases. Each entry has a version, date, short plain-language lines, and a link to its GitHub release. Keep it readable without JavaScript and use the homepage's colors, type, navigation, and footer. For future releases, a line may end with a small author tag: `-countdxwn` or `-destoryer10`. Past releases have no author tags.
