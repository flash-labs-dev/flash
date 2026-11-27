// Clip and screenshot file naming, mirroring what the native ClipWriter does.
//
// The capture engine names clips in C++ (ClipWriter::GenerateClipPath), which
// is fine while only C++ creates files. Screenshots and frame grabs are created
// from TypeScript, and a screenshot sitting next to a clip with a differently
// shaped name would look like it came from another program. So the format lives
// here too, deliberately duplicated, with a self-check pinning it — the
// alternative is exporting a path builder across the N-API boundary purely to
// format a date, which is a lot of machinery for eight fields.
//
// Keep in step with packages/flash-capture/src/buffer/clip_writer.cpp.

import { caseKey } from './clipsRoot.ts'

const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g

// Flash names every clip and screenshot YYYY-MM-DD_HH-MM-SS, with an optional
// _N suffix for a second file in the same second. The auto-delete timer uses
// this as one signal that a media file came from Flash.
const FLASH_TIMESTAMP_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?\.(?:mp4|png)$/i

export const sidecarPath = (filePath: string): string => `${filePath}.json`

export function isFlashClipName(fileName: string): boolean {
  return FLASH_TIMESTAMP_NAME.test(fileName)
}

export function isFlashClip(fileName: string, sidecar: unknown): boolean {
  if (sidecar === null) return isFlashClipName(fileName)
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return false
  const metadata = sidecar as { unreadable?: boolean; duration?: unknown; game?: unknown }
  if (metadata.unreadable || Object.keys(metadata).some(key =>
    !['duration', 'game', 'marksSec', 'trim', 'starred', 'tags', 'cachedShare'].includes(key))) return false
  return isFlashClipName(fileName) || (typeof metadata.duration === 'number' && Number.isFinite(metadata.duration) &&
    metadata.duration >= 0 && typeof metadata.game === 'string' && metadata.game.length > 0) ||
    metadata.game === 'Shared clip'
}

// birthtime is 0 on filesystems that do not record it (many Linux mounts), and
// a clip dated 1970 would be old enough for every auto-delete timer. Fall back
// to mtime; 0 means the age is genuinely unknown and nothing may prune on it.
export function clipCreatedAt(stat: { birthtimeMs: number; mtimeMs: number }): number {
  if (stat.birthtimeMs > 0) return stat.birthtimeMs
  if (stat.mtimeMs > 0) return stat.mtimeMs
  return 0
}

// Local time, not UTC: the timestamp is what the player saw on their own clock,
// and a clip recorded at 9pm should not be named 02-00-00.
export function clipTimestamp(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `_${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`
}

// Anything Windows refuses in a path becomes an underscore rather than being
// dropped, so two games whose names differ only in punctuation cannot collapse
// into one folder.
export function gameFolderName(game: string, platform = process.platform): string {
  let safe = game.trim().replace(FORBIDDEN, '_')
  // Windows silently drops trailing dots and spaces, so "R.E.P.O." has always
  // been the folder "R.E.P.O" on disk. Keep that name, and keep it everywhere.
  if (platform === 'win32') safe = safe.replace(/[. ]+$/, '')
  if (!safe || safe === '.' || safe === '..') return 'Unknown'
  return platform === 'win32' && /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(safe) ? `_${safe}` : safe
}

// Matches the native counter exactly: the first file is bare, and only the
// second onward carries a suffix.
export function numberedName(stem: string, counter: number, extension: string): string {
  return counter <= 1 ? `${stem}${extension}` : `${stem}_${counter}${extension}`
}

// `taken` is whatever already exists in the folder. Returns the first free
// name rather than overwriting, which is the one behaviour every caller of this
// depends on.
export function firstFreeName(stem: string, extension: string, taken: readonly string[], platform = process.platform): string {
  const used = new Set(taken.map(name => caseKey(name, platform)))
  for (let counter = 1; ; counter++) {
    const candidate = numberedName(stem, counter, extension)
    if (!used.has(caseKey(candidate, platform)) && !used.has(caseKey(sidecarPath(candidate), platform))) return candidate
  }
}
