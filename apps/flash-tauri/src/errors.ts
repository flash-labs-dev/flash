// Release builds have no devtools: send uncaught renderer errors to the Rust log.
import { invoke } from '@tauri-apps/api/core'

const report = (message: string) => { invoke('ipc', { channel: 'renderer-log', args: [message] }).catch(() => {}) }
window.addEventListener('error', e => report(`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`))
window.addEventListener('unhandledrejection', e => report(`unhandled rejection: ${e.reason instanceof Error ? e.reason.stack : String(e.reason)}`))
// Warnings too: the renderer reports recoverable failures (thumbnails, playback) with console.warn.
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => { original(...args); report(`${level}: ${args.map(a => a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`) }
}
