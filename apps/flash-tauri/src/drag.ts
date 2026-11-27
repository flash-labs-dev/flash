// Electron moves frameless windows by the CSS `-webkit-app-region: drag` the UI
// already sets (.titlebar-drag); WebKitGTK ignores it, so do the same by hand.
import { getCurrentWindow } from '@tauri-apps/api/window'

window.addEventListener('mousedown', event => {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  if (!target.closest('.titlebar-drag') || target.closest('.titlebar-no-drag, button, a, input, select, textarea, [role="button"]')) return
  event.preventDefault()
  if (event.detail === 2) void getCurrentWindow().toggleMaximize()
  else void getCurrentWindow().startDragging()
})
