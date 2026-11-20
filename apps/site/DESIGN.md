# Flash site: design contract

Marketing and download page for flashclipping.fyi. Static HTML, one file, no build step, no dependencies. It extends the app's design language in `apps/desktop/DESIGN.md`; where the two differ, the app wins.

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

## Sections

1. Hero: full-bleed looping goal clip, "Never miss the clip.", one primary download button, version line. Button follows the visitor's OS (Windows default, Linux on Linux, "Get Flash" on phones).
2. Steps: three 4:5 clip stages (Always recording, Press one key, Send a link). Each has one CSS-only overlay: REC chip with a filling buffer bar; F8 keycap press with a "Clip saved" toast; share link card with Discord, Instagram, TikTok, X and YouTube marks.
3. Clip wall: six looping tiles with a game chip.
4. Get Flash: Windows card (primary) and Linux card (outline, marked experimental). One line on the SmartScreen warning because the installer is unsigned.
5. Footer: Releases, Source, Feedback.

## Behaviour

- Download links default to the current release asset URLs in the HTML so the page works with no JavaScript. A script then reads the GitHub releases list (pre-releases included, since there is no stable release yet) and updates asset URLs, sizes and version text. If the request fails the static values stay.
- Videos are muted, looped, `playsinline`, with a poster frame. They play only while on screen. With `prefers-reduced-motion` they stay on the poster and the CSS animations stop.
- Layout collapses at 860px: nav links hide, steps stack, wall becomes two columns, cards stack. 16px minimum side gutters on phones (20px used).

## Footage rules

- 4 s tiles at 640px wide; hero 9 s at 1280px. H.264, no audio, `+faststart`.
- Minecraft clips have the bottom-left kill feed pixelated. Opponent nametags can still show in-world; re-check this before adding new Minecraft footage.
- No private information in frame: no Discord windows, desktop, or account names.

## Hosting

Cloudflare Pages, root directory `apps/site`, no build command. `share.flashclipping.fyi` stays on the existing tunnel and is not touched by the site.

## Out of scope for now

Feedback widget, changelog page, signed installers, auto-update messaging.
