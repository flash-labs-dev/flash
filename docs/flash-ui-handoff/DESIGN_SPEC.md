# Flash — UI Redesign Spec

Dark, quiet desktop UI for a game clipping app. Inspired by the structure of tools like Medal (sidebar + library grid + clip viewer + settings), but its own look: no gradients, no glow, no decorative cards. Red is reserved for "live" things (recording state, trim selection, toggles that are on).

## 1. Design tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| `bg-chrome` | `#0b0b0c` | Title bar, sidebar, window background |
| `bg-content` | `#0f0f11` | Main content area |
| `surface` | `#141417` | Panels / setting groups |
| `surface-input` | `#17171a` | Inputs, selects, secondary buttons |
| `surface-hover` | `#1c1c20` | Active nav item, hover, tag chips |
| `border` | `#1f1f23` | Chrome dividers (sidebar edge, header bottom) |
| `border-subtle` | `#222226` | Panel borders, row dividers |
| `border-input` | `#2a2a2f` | Inputs, buttons |
| `text` | `#f4f4f5` | Primary text, primary button background |
| `text-secondary` | `#d4d4d8` | Secondary labels |
| `text-muted` | `#9a9aa3` | Descriptions, metadata |
| `text-faint` | `#8b8b94` | Section headers, icons at rest |
| `accent` | `#d10f0f` | Trim handles/selection, toggle on |
| `danger-text` | `#ff7b7b` | Delete action text |
| `error-bg` / `error-border` / `error-icon` | `#1a1112` / `#4a1d20` / `#ff6b6b` | Error banner |

### Game icons
Every place a game is named shows the **game's real icon** (16px on clip cards, 18px in the title-bar pill, 22px in the viewer), radius 4–5px. The mockups use lettered squares as stand-ins only.
- Source, in order: (1) icon extracted from the game's executable (Electron: `app.getFileIcon(exePath, { size: 'large' })`; native: `SHGetFileInfo` / `ExtractIconEx`), cached as PNG per game; (2) a store/database art lookup if we have one (Steam app icon, IGDB); (3) fallback: rounded square with the game's first letter on a neutral `#2a2a30` background.
- Cache icons on disk keyed by exe path/hash; never block rendering on them.

### Type
- Font: **Inter** (400/500/600). Fallback `system-ui, sans-serif`.
- Page title 22–24px / 600 / letter-spacing -0.01em
- Body 14px / 500 for labels, 13px / 400 for descriptions
- Section headers 12px / 500 / `text-faint` — sentence case, NOT uppercase
- Metadata 12px / `text-muted`
- Numbers that change (timecodes): `font-variant-numeric: tabular-nums`

### Shape & spacing
- Radius: 6px (buttons, nav items, thumbnails), 8px (panels, inputs). Pills (tags, status) fully round.
- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 28 / 32.
- Control heights: 34px (small buttons, inputs), 40px (nav items, icon buttons, primary actions).

### Icons
- Line icons, **20px** default, stroke **1.6**, round caps/joins, `currentColor`. 22px in settings rows, 40px for empty-state illustration (stroke 1.4).
- Use Lucide (or the existing icon set if the repo has one) — matches the stroke style in the reference files.
- Icon-only buttons: 40×40 hit area, `aria-label` required.

### Logo
- In-app: **bolt-F glyph only, no background**, filled `text` color (`assets/logo-bolt.svg`, uses `currentColor`), ~22px wide, next to the word "Flash" (16px / 600).
- App/taskbar icon: `assets/flash-icon-white-gradient.png` (or `-red`), SVG sources included.

## 2. App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [bolt] Flash   (● Buffering  Rocket League)  F9 Save clip  Alt F10 Record │ 🔍 🔔 (C) │ – □ × │  ← 56px title bar, draggable
├───────────────┬──────────────────────────────────────────────────────────┤
│ Library       │                                                          │
│ Games         │                    page content                          │
│ Favorites     │                                                          │
│ Screenshots   │                                                          │
│ Recordings    │                                                          │
│ Trash         │                                                          │
│ Albums     +  │                                                          │
│  Best plays   │                                                          │
│  Ranked       │                                                          │
│               │                                                          │
│ Storage Manage│                                                          │
│ ▓▓▓░░░░░░░░   │                                                          │
│ Settings      │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
   232px sidebar
```

- **Title bar** (custom frameless window): logo + name; **status pill** (no dot: detected game's icon + "Buffering" + game name; just "Not recording" when idle/broken); hotkey hints rendered as `<kbd>` chips read from the user's real hotkey settings; search, notifications, account avatar; window controls (44×44 each). Whole bar is a drag region except interactive elements.
- **Sidebar**: nav items 40px tall, 20px icon + label, active = `surface-hover` bg + `text` color (no colored bar). Albums section header with a "+" button. Storage meter pinned to the bottom (thin 6px bar, "[used] of [total] used", "Manage" link → Settings › Storage), then Settings.

## 3. Screens

### Library (`reference/Library.dc.html`)
- Header row: "Library" title (left), search input 260px (right).
- Tabs: All / Clips / Recordings / Screenshots — active tab has a 2px `text`-colored underline. Right side: Game select, Sort select, grid/list toggle.
- Clips grouped by date buckets ("Today", "Yesterday", "Earlier this week", then month names).
- Grid: `repeat(auto-fill, minmax(250px, 1fr))`, 16px gap.
- Clip card: borderless. 16:9 thumbnail (radius 6) with a type badge top-left (CLIP / RECORDING / SHOT) and duration bottom-right (black 70% chip). Under it: title (14/500, ellipsis), meta row `[game icon 16px] Game · time`, then copy-link and ⋯ icon buttons on the right. Click thumbnail → viewer.

### Clip viewer (`reference/Viewer.dc.html`)
- Left: "← Library" back button; ← → keyboard hint. Player 16:9, bottom control bar (play, timecode, volume, fullscreen).
- Trim panel under the player: filmstrip track, dimmed outside selection, accent border + handles on the selection, white playhead. Shows "0:04 – 0:22 · 18s selected", Reset and **Save trimmed copy** (primary).
- Right details panel (340–380px): Title input, 3 stat tiles (Captured / Length / Quality), Game, Tags (chips + "Add tag"), Notes textarea. Bottom actions: **Copy link** (primary), Export, Favorite, Delete (danger text).
- Keyboard: ←/→ previous/next clip, Space play/pause, Delete → confirm delete.

### Settings › Hotkeys (`reference/Settings.dc.html`)
- Second-level nav (220px): search, then groups — Capture (Hotkeys, Replay buffer, Video quality, Audio, Games), Storage (Save location, Auto cleanup), App (General, Notifications, In-game overlay, Account).
- Content max-width 820px. Title + one-line description.
- Hotkey group panel: rows = icon (22px) · name + description · optional select (Save clip has clip length) · key button (shows `<kbd>` chips, click to enter "press a key…" capture state, Esc cancels) · ⋯ menu (reset / remove). "Add hotkey" at the bottom.
- Second panel: toggles ("Play a sound when a clip is saved", "Show in-game toast"). Toggle = 44×26 switch, accent when on, `role="switch"`.

### Empty + error (`reference/Empty.dc.html`)
- Error banner (only when capture engine fails to load): alert icon, "Capture engine unavailable" + reason, **View logs** and **Retry**. Status pill switches to "Not recording".
- Empty state, centered, no box: scissors icon 40px faint, "No clips yet", "Press [F9] in a game to save the last 30 seconds." (use real hotkey + buffer length), buttons "Set up hotkeys" (→ settings) and "Import from PC".

## 4. Copy rules
- Short, plain, no marketing tone, no exclamation marks.
- Default clip title "Untitled clip". Use real values; never hardcode placeholder numbers in production.

## 5. Accessibility
- Real `<button>`, `<a>`, `<input>`/`<label>` everywhere; visible focus ring (2px `text` outline, 2px offset).
- Text contrast ≥ 4.5:1 (the token pairs above pass on `bg-content`).
- Icon-only buttons have `aria-label`; decorative SVGs `aria-hidden`.

## 6. About the reference files
`reference/*.dc.html` are design-canvas files (an internal mockup format: HTML with inline styles, `{{holes}}`, `<sc-for>` loops, and a `support.js` runtime that isn't included). Use them to read exact sizes, colors, spacing and structure — **do not ship them or copy the format**. Rebuild the UI in the app's own stack and component system.
