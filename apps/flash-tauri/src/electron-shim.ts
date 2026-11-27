// Just enough of Electron's renderer API for apps/desktop/src/preload/preload.ts.
// invoke/send become the Rust `ipc` command; main-to-renderer messages arrive as
// Tauri events whose payload is the argument list.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type IpcRendererEvent = { sender: null }
type Listener = (event: IpcRendererEvent, ...args: any[]) => void

const listeners = new Map<string, Set<Listener>>()
const event: IpcRendererEvent = { sender: null }

export const ipcRenderer = {
  // Bytes cross as number arrays (JSON); thumbnail-read is the one call that returns them.
  invoke: async (channel: string, ...args: unknown[]) => {
    const result = await invoke('ipc', { channel, args: args.map(a => a instanceof Uint8Array ? Array.from(a) : a) })
    return channel === 'thumbnail-read' && Array.isArray(result) ? new Uint8Array(result) : result
  },
  send(channel: string, ...args: unknown[]) {
    invoke('ipc', { channel, args }).catch(error => console.warn(`flash: ${channel} failed`, error))
  },
  on(channel: string, listener: Listener) {
    let set = listeners.get(channel)
    if (!set) {
      const fresh = new Set<Listener>()
      listeners.set(channel, set = fresh)
      void listen<unknown>(channel, ({ payload }) => {
        const args = Array.isArray(payload) ? payload : [payload]
        for (const handler of fresh) handler(event, ...args)
      })
    }
    set.add(listener)
    return ipcRenderer
  },
  removeListener(channel: string, listener: Listener) {
    listeners.get(channel)?.delete(listener)
    return ipcRenderer
  },
}

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown) { (window as unknown as Record<string, unknown>)[key] = api },
}
