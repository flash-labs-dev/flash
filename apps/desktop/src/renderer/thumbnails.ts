import { useEffect, useState } from 'react'
import { clipUrl } from '../shared/editor'
import { thumbnailTime } from '../shared/thumbnailTime'

// One still per clip, made once and kept on disk by the main process. Tiles
// used to be live <video> elements that were unloaded off-screen to stay under
// Chromium's decoder cap, so every scroll back showed black tiles reloading.
// An <img> from an object URL paints instantly and costs no decoder at all.

const WIDTH = 480
const HEIGHT = 270

// filePath -> object URL. Survives view switches and re-renders for the whole
// session, so a tile that has been seen once never loads again.
const ready = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
const listeners = new Map<string, Set<() => void>>()
const cacheKey = (filePath: string, markSec: number | null) => markSec === null ? filePath : `${filePath}\0${markSec}`

// Making a still means decoding a frame, which is the expensive part this
// exists to avoid doing twice. Two at a time keeps the first visit to a big
// library quick without fighting the capture encoder for the GPU decoder.
const MAX_ACTIVE = 2
let active = 0
const queue: Array<() => void> = []
function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++
      job().then(resolve, reject).finally(() => {
        active--
        queue.shift()?.()
      })
    }
    if (active < MAX_ACTIVE) run()
    else queue.push(run)
  })
}

function toUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
}

function grabStill(filePath: string, markSec: number | null): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    let settled = false
    const finish = (bytes: Uint8Array | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      video.remove?.()
      resolve(bytes)
    }
    // A clip that cannot decode must not hold a queue slot forever.
    const timer = setTimeout(() => finish(null), 8000)
    video.addEventListener('error', () => finish(null), { once: true })
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = markSec !== null && markSec <= video.duration
        ? (markSec === 0 ? Math.min(0.001, video.duration / 2) : markSec)
        : thumbnailTime([], video.duration).timeSec
    }, { once: true })
    // WebKitGTK only decodes frames for a video in the document, and fires
    // seeked before the frame is drawable; wait for the frame itself.
    if (video.style) video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
    document.body?.appendChild(video)
    video.addEventListener('seeked', () => {
      const frame = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback
      if (frame) frame.call(video, draw)
      else setTimeout(draw, 150)
    }, { once: true })
    const draw = () => {
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const context = canvas.getContext('2d')
      if (!context) { finish(null); return }
      // Cover-fit, matching how the tile crops the clip.
      const scale = Math.max(WIDTH / video.videoWidth, HEIGHT / video.videoHeight)
      const w = video.videoWidth * scale
      const h = video.videoHeight * scale
      context.drawImage(video, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
      // An all-black grab is a frame that was not ready, not the clip: never cache it.
      const pixels = context.getImageData?.(0, 0, WIDTH, HEIGHT).data ?? [255, 255, 255]
      let lit = false
      for (let i = 0; i < pixels.length && !lit; i += 4 * 97) lit = pixels[i] + pixels[i + 1] + pixels[i + 2] > 24
      if (!lit) { finish(null); return }
      canvas.toBlob(async blob => {
        finish(blob ? new Uint8Array(await blob.arrayBuffer()) : null)
      }, 'image/jpeg', 0.82)
    }
    video.src = clipUrl(filePath)
  })
}

// `fresh` is a newly grabbed still the caller still has to save.
async function load(filePath: string, kind: 'clip' | 'shot', markSec: number | null): Promise<{ url: string; fresh?: Uint8Array } | null> {
  // Screenshots are already images; the file itself is the thumbnail.
  if (kind === 'shot') return { url: clipUrl(filePath) }
  const cached = await window.flash?.readThumbnail(filePath, markSec)
  if (cached && cached.length) return { url: toUrl(cached) }
  const bytes = await schedule(() => grabStill(filePath, markSec))
  return bytes ? { url: toUrl(bytes), fresh: bytes } : null
}

export function thumbnailFor(filePath: string, kind: 'clip' | 'shot' = 'clip', marksSec: readonly number[] = [], durationSec = 0): Promise<string | null> {
  const choice = thumbnailTime(marksSec, durationSec)
  const markSec = kind === 'clip' && choice.fromMark ? choice.timeSec : null
  const key = cacheKey(filePath, markSec)
  const known = ready.get(key)
  if (known) return Promise.resolve(known)
  let job = pending.get(key)
  if (!job) {
    const started: Promise<string | null> = load(filePath, kind, markSec).then(result => {
      // Dropped by retainThumbnails while loading: the path may be another file now.
      if (pending.get(key) !== started) {
        if (result?.url.startsWith('blob:')) URL.revokeObjectURL(result.url)
        return null
      }
      pending.delete(key)
      if (!result) return null
      if (result.fresh) window.flash?.writeThumbnail(filePath, result.fresh, markSec)
      ready.set(key, result.url)
      listeners.get(key)?.forEach(listener => listener())
      return result.url
    }, () => { if (pending.get(key) === started) pending.delete(key); return null })
    pending.set(key, started)
    job = started
  }
  return job
}

// Forgets stills for files that left the library. Without this, a clip renamed
// or moved onto a deleted clip's path would show the deleted clip's picture.
export function retainThumbnails(clips: readonly { filePath: string; kind: 'clip' | 'shot'; marksSec: readonly number[]; durationSec: number }[]): void {
  const keep = new Set(clips.map(clip => {
    const choice = thumbnailTime(clip.marksSec, clip.durationSec)
    return cacheKey(clip.filePath, clip.kind === 'clip' && choice.fromMark ? choice.timeSec : null)
  }))
  for (const [key, url] of ready) {
    if (keep.has(key)) continue
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    ready.delete(key)
  }
  for (const key of pending.keys()) if (!keep.has(key)) pending.delete(key)
}

// The still for a clip: available synchronously once it has been seen, so
// remounting a tile paints on its first frame with no flash.
export function useThumbnail(filePath: string | undefined, kind: 'clip' | 'shot' = 'clip', enabled = true, marksSec: readonly number[] = [], durationSec = 0): string | null {
  const choice = thumbnailTime(marksSec, durationSec)
  const key = filePath ? cacheKey(filePath, kind === 'clip' && choice.fromMark ? choice.timeSec : null) : null
  // Read from the map on every render, so a changed path never shows the old still.
  const url = key ? ready.get(key) ?? null : null
  const [, setLoads] = useState(0)
  useEffect(() => {
    if (!filePath || !key) return
    const redraw = () => setLoads(count => count + 1)
    // Became ready between the render and this effect.
    if (ready.has(key)) { if (!url) redraw(); return }
    if (!enabled) return
    const set = listeners.get(key) ?? new Set()
    set.add(redraw)
    listeners.set(key, set)
    void thumbnailFor(filePath, kind, marksSec, durationSec)
    return () => {
      set.delete(redraw)
      if (!set.size && listeners.get(key) === set) listeners.delete(key)
    }
  }, [filePath, kind, enabled, url, key])
  return url
}
