// Theme palettes for the full-bleed feed look: near-black neutrals with a
// faint tint, and an accent that only ever marks something live or engaged.
// Imported by both the main process (toast popup) and the renderer, so it lives
// outside src/main and src/renderer. Keep in sync with renderer/index.css.

export const WINDOW_TOKENS = { control: 6, popover: 8, dialog: 10, tracking: '0.14em' } as const

export interface Theme {
  label: string
  bg: string
  panel: string
  field: string
  edge: string
  hover: string
  fg: string
  muted: string
  accent: string
  accentDim: string
  onAccent: string
  spark: string
  alert: string
}

export const THEMES: Record<string, Theme> = {
  blood: {
    label: 'Blood',
    bg: '#0B0B0C', panel: '#141417', field: '#17171A', edge: '#2A2A2F', hover: '#1C1C20',
    fg: '#F4F4F5', muted: '#9A9AA3', accent: '#D10F0F', accentDim: '#7A0909',
    onAccent: '#FFFFFF', spark: '#FFB020',
    // The accent is red on this theme, so errors move to a hot rose that cannot
    // be mistaken for a live state.
    alert: '#FF6B8E',
  },
}

export const DEFAULT_THEME = 'blood'

export const getTheme = (name: string): Theme => THEMES[name] ?? THEMES[DEFAULT_THEME]
