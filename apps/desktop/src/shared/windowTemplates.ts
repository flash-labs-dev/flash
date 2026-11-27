import { getTheme, WINDOW_TOKENS } from './themes.ts'

function style(theme: string, font: string) {
  const t = getTheme(theme)
  return `
    @font-face{font-family:Geist;src:url('${font}') format('woff2');font-weight:100 900;font-display:swap}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Geist,system-ui,sans-serif;background:transparent;color:${t.fg};overflow:hidden;user-select:none;-webkit-user-select:none;cursor:default}
    .surface{background:${t.bg};border:1px solid ${t.edge};border-radius:${WINDOW_TOKENS.popover}px}
    .label{font-size:11px;font-weight:600}
    .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${t.accent}}
    .dot.idle{background:${t.muted}}
    .dot.live{animation:pulse 1.6s ease-in-out infinite}
    @keyframes pulse{50%{opacity:.4}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  `
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// Slides in from, and back out to, the screen edge nearest its corner.
export function toastHtml(theme: string, font: string, durationSeconds: number, game = '', position = 'top-left') {
  const t = getTheme(theme)
  const seconds = Math.max(0, Math.floor(durationSeconds))
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const meta = game && game !== 'Unknown' ? `${duration} · ${escapeHtml(game)}` : duration
  const away = position.endsWith('right') ? 'calc(100% + 24px)' : 'calc(-100% - 24px)'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${style(theme, font)}
    .toast{height:64px;display:flex;align-items:center;gap:12px;padding:0 16px;background:${t.panel};
      animation:enter .42s cubic-bezier(.16,1,.3,1) both}
    .toast.out{animation:leave .28s cubic-bezier(.7,0,.84,0) both}
    .icon{display:flex;flex-shrink:0;color:#fff}
    .text{min-width:0}
    h3{font-size:14px;font-weight:500;letter-spacing:-.01em;line-height:18px}
    p{font-size:12px;line-height:16px;color:${t.muted};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @keyframes enter{from{transform:translateX(${away})}to{transform:none}}
    @keyframes leave{to{transform:translateX(${away})}}
  </style></head><body><div class="surface toast" id="toast">
    <div class="icon"><svg width="22" height="25" viewBox="300 232 540 606" aria-hidden="true"><polygon points="380,250 820,250 790,350 480,350 462,430 700,430 480,820 520,560 320,560" fill="currentColor" stroke="currentColor" stroke-width="26" stroke-linejoin="round"/></svg></div>
    <div class="text"><h3>Clip saved</h3><p>${meta}</p></div></div>
    <script>window.leave = () => document.getElementById('toast').classList.add('out')</script></body></html>`
}

export function overlayHtml(theme: string, font: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${style(theme, font)}
    .pill{height:40px;display:flex;align-items:center;gap:9px;padding:10px 14px;opacity:0;transition:opacity .16s ease}
    .pill.on{opacity:1}
    .label{flex-shrink:0}
    .game{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  </style></head><body><div class="surface pill" id="pill"><div class="dot" id="dot"></div><span class="label" id="label">REC</span><span class="game" id="game"></span></div>
    <script>window.setState = s => {
      document.getElementById('pill').className = 'surface pill' + (s.visible ? ' on' : '')
      document.getElementById('dot').className = 'dot ' + (s.recording || s.saving ? 'live' : 'idle')
      document.getElementById('label').textContent = s.saving ? 'SAVING' : s.recording ? 'REC' : 'IDLE'
      document.getElementById('game').textContent = s.game || ''
    }</script></body></html>`
}

export function cornerBounds(area: { x: number; y: number; width: number; height: number }, position: string, width: number, height: number) {
  const pad = 16
  return { width, height,
    x: position.endsWith('right') ? area.x + area.width - width - pad : area.x + pad,
    y: position.startsWith('bottom') ? area.y + area.height - height - pad : area.y + pad,
  }
}
