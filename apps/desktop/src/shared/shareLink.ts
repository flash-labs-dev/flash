// Share links: the clip is uploaded to the home server, which answers with a
// short path. Shared by the main process (which uploads) and the self-check.

export const SHARE_ORIGIN = 'https://share.flashclipping.fyi'
export const SHARE_PAGE_ORIGIN = 'https://flashclipping.fyi'
export const SHARE_UPLOAD_ENDPOINT = `${SHARE_ORIGIN}/flash-clips`
// The server enforces the same cap; checking first avoids a long upload that
// is certain to be refused.
export const SHARE_MAX_BYTES = 100 * 1048576
export const SHARE_DAYS = 7
export const SHARE_TARGET_KBPS = 5000

export interface FlashLink {
  id: string
  mp4Url: string
}

const SHARE_ORIGINAL_MAX_KBPS = 5500
const SHARE_COPY_MIN_BYTES = 1048576

export function shareCopyMaxBytes({ durationSeconds, fileBytes }: {
  durationSeconds: number
  fileBytes: number
}): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) return null
  const originalKbps = fileBytes * 8 / durationSeconds / 1000
  if (originalKbps <= SHARE_ORIGINAL_MAX_KBPS) return null
  return Math.max(SHARE_COPY_MIN_BYTES, Math.ceil(durationSeconds * SHARE_TARGET_KBPS * 1000 / 8))
}

export function checkShareSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'The clip is empty.'
  if (bytes > SHARE_MAX_BYTES) {
    return `This clip is over ${Math.round(SHARE_MAX_BYTES / 1048576)}MB. Export a smaller copy and share that.`
  }
  return null
}

// The server's answer is data, not instructions: only a path of the exact shape
// it generates becomes a link, and it is always joined to our own origin.
export function shareUrlFromPath(path: unknown): string | null {
  if (typeof path !== 'string' || !/^\/c\/[A-Za-z0-9_-]{12}\.mp4$/.test(path)) return null
  return SHARE_PAGE_ORIGIN + path.slice(0, -4)
}

// Custom-protocol input comes from the operating system and is untrusted. Keep
// this parser deliberately narrower than URL: no query, fragment, credentials,
// alternate host, encoded path, or extra segment is meaningful to Flash.
export function parseFlashLink(raw: string): FlashLink | null {
  if (typeof raw !== 'string') return null
  const match = /^flash:\/\/c\/([A-Za-z0-9_-]{12})\/?$/.exec(raw)
  if (!match) return null
  return { id: match[1], mp4Url: `${SHARE_ORIGIN}/c/${match[1]}.mp4` }
}
