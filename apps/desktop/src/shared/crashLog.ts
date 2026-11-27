import { appendFileSync, statSync, writeFileSync } from 'node:fs'

export const CRASH_LOG_MAX_BYTES = 256 * 1024

// A local record of what killed the main process. Nothing is sent anywhere.
export function recordCrash(path: string, error: unknown, origin: string, now = new Date()): void {
  try {
    const detail = error instanceof Error ? error.stack ?? String(error) : String(error)
    let size = 0
    try { size = statSync(path).size } catch { /* no log yet */ }
    const write = size > CRASH_LOG_MAX_BYTES ? writeFileSync : appendFileSync
    write(path, `${now.toISOString()} ${origin}\n${detail}\n`)
  } catch {
    // The process is already failing; a failed log must not replace the real error.
  }
}
