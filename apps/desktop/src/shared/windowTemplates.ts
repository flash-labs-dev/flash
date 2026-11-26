import { getTheme, WINDOW_TOKENS } from './themes.ts'

function style(theme: string, font: string) {
  const t = getTheme(theme)
  return `
    @font-face{font-family:Geist;src:url('${font}') format('woff2');font-weight:100 900;font-display:swap}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Geist,system-ui,sans-serif;background:transparent;color:${t.fg};overflow:hidden}
    .surface{background:${t.bg};border:1px solid ${t.edge};border-radius:${WINDOW_TOKENS.popover}px}
    .label{font-size:11px;font-weight:600;letter-spacing:${WINDOW_TOKENS.tracking};text-transform:uppercase}
    .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${t.accent}}
    .dot.idle{background:${t.muted}}
    .dot.live{animation:pulse 1.6s ease-in-out infinite}
    @keyframes pulse{50%{opacity:.4}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  `
}

export function toastHtml(theme: string, font: string, durationSeconds: number) {
  const seconds = Math.max(0, Math.floor(durationSeconds))
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const accent = getTheme(theme).accent
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${style(theme, font)}
    .toast{height:64px;display:flex;align-items:center;gap:12px;padding:0 16px;border-radius:12px;
      animation:enter .32s cubic-bezier(.16,1,.3,1) both}
    .toast.out{animation:leave .22s cubic-bezier(.4,0,1,1) both}
    .badge{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;flex-shrink:0;background:${accent}}
    .badge path{stroke-dasharray:24;stroke-dashoffset:24;animation:draw .3s .14s ease-out forwards}
    h3{font-size:14px;font-weight:600;letter-spacing:-.01em;margin-bottom:2px}
    p{font-size:12px;opacity:.6;font-variant-numeric:tabular-nums}
    @keyframes enter{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes leave{to{opacity:0;transform:translateY(-4px) scale(.98)}}
    @keyframes draw{to{stroke-dashoffset:0}}
    @media(prefers-reduced-motion:reduce){.badge path{stroke-dashoffset:0}}
  </style></head><body><div class="surface toast" id="toast">
    <div class="badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <div><h3>Clip saved</h3><p>${duration} saved to library</p></div></div>
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
