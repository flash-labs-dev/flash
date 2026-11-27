export type ShareResult = { ok: true; url: string; days: number } | { ok: false; error: string }

export interface ShareProgress {
  completed: number
  total: number
  failed: number
}

export interface ShareSelectionResult extends ShareProgress {
  urls: string[]
  stoppedBy: string | null
}

export function isShareCapacityError(error: string): boolean {
  return error === 'Too many links this hour. Try again later.' ||
    error === 'The share server is full right now.'
}

export async function shareWhenAvailable(
  path: string,
  share: (path: string) => Promise<ShareResult>,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 150)),
  shouldStop?: () => boolean,
): Promise<ShareResult> {
  while (true) {
    const result = await share(path)
    if (result.ok || result.error !== 'A link is already being made') return result
    await wait()
    // Stop pressed while queued: never start a public upload afterwards.
    if (shouldStop?.()) return result
  }
}

// The caller supplies the upload operation; this helper only sequences results.
export async function shareSelection(
  paths: readonly string[],
  share: (path: string) => Promise<ShareResult>,
  onProgress?: (progress: ShareProgress) => void,
  shouldStop?: () => boolean,
): Promise<ShareSelectionResult> {
  const result: ShareSelectionResult = {
    completed: 0, total: paths.length, failed: 0, urls: [], stoppedBy: null,
  }

  for (const path of paths) {
    if (shouldStop?.()) break
    try {
      const response = await share(path)
      // A clip still queued when Stop was pressed was never attempted.
      if (!response.ok && response.error === 'A link is already being made' && shouldStop?.()) break
      if (response.ok) result.urls.push(response.url)
      else {
        result.failed++
        if (isShareCapacityError(response.error)) result.stoppedBy = response.error
      }
    } catch {
      result.failed++
    }
    result.completed++
    onProgress?.({ completed: result.completed, total: result.total, failed: result.failed })
    if (result.stoppedBy) break
  }

  return result
}
