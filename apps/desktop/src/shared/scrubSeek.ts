// The browser may still be decoding a previous seek when pointer moves arrive.
// Keep only the newest destination and check the media element once per frame.
export interface SeekableVideo {
  currentTime: number
  readonly seeking: boolean
  addEventListener(type: 'seeking' | 'seeked', listener: () => void): void
  removeEventListener(type: 'seeking' | 'seeked', listener: () => void): void
}

export function createScrubSeekScheduler(
  video: SeekableVideo,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
) {
  let latest: number | null = null
  let frame: number | null = null
  let inFlight = false
  let disposed = false

  const schedule = () => {
    if (!disposed && frame === null) frame = requestFrame(flush)
  }

  const flush = () => {
    frame = null
    if (disposed) return
    // A seek can be aborted without a seeked event. Polling seeking also
    // releases the slot in that case.
    if (video.seeking) { schedule(); return }
    inFlight = false
    if (latest === null) return
    const target = latest
    latest = null
    if (target === video.currentTime) return // no seeked event for a no-op
    try {
      video.currentTime = target
      inFlight = video.seeking
    } catch {
      // A source swap can invalidate a pending seek. A later request can run.
      inFlight = false
    }
    if (inFlight || latest !== null) schedule()
  }

  const onSeekState = () => {
    if (inFlight || latest !== null) schedule()
  }
  video.addEventListener('seeking', onSeekState)
  video.addEventListener('seeked', onSeekState)

  return {
    request(seconds: number) {
      if (disposed || !Number.isFinite(seconds)) return
      latest = seconds
      schedule()
    },
    dispose() {
      disposed = true
      latest = null
      inFlight = false
      if (frame !== null) cancelFrame(frame)
      frame = null
      video.removeEventListener('seeking', onSeekState)
      video.removeEventListener('seeked', onSeekState)
    },
  }
}
