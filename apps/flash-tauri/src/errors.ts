// Release builds have no devtools: send uncaught renderer errors to the Rust log.
import { invoke } from '@tauri-apps/api/core'

const report = (message: string) => { invoke('ipc', { channel: 'renderer-log', args: [message] }).catch(() => {}) }
window.addEventListener('error', e => report(`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`))
window.addEventListener('unhandledrejection', e => report(`unhandled rejection: ${e.reason instanceof Error ? e.reason.stack : String(e.reason)}`))
