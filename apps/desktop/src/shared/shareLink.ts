// Share links: the clip is uploaded to the home server, which answers with a
// short path. Shared by the main process (which uploads) and the self-check.

export const SHARE_ORIGIN = 'https://lubuntuserver.tail857ab5.ts.net:10000'
export const SHARE_UPLOAD_ENDPOINT = `${SHARE_ORIGIN}/flash-clips`
// The server enforces the same cap; checking first avoids a long upload that
// is certain to be refused.
export const SHARE_MAX_BYTES = 100 * 1048576
export const SHARE_DAYS = 7

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
  return SHARE_ORIGIN + path
}
