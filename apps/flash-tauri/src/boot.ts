// Order matters: error reporting first, then the desktop preload sets
// window.flash (through the shim), then the UI mounts. Clips play from the
// Rust side's loopback server, whose address the UI needs before it renders.
import './errors'
import './drag'
import { invoke } from '@tauri-apps/api/core'

;(globalThis as { __FLASH_CLIP_BASE?: string }).__FLASH_CLIP_BASE = await invoke<string>('ipc', { channel: 'clip-base', args: [] }).catch(() => '')
await import('../../desktop/src/preload/preload')
await import('../../desktop/src/renderer/main')
