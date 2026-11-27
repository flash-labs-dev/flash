import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipActionBar } from './ClipActionBar'
import { clipDisplayTitle } from '../shared/clipTitle'
import { AudioLanes } from './editor/AudioLanes'
import { Filmstrip, TRIM_SNAP_SEC } from './editor/Filmstrip'
import { useLiveMix } from './editor/useLiveMix'
import { useClipAudio } from './editor/useClipAudio'
import type { LiveMixTrack } from './editor/useLiveMix'
import { clampRange, clipUrl, deriveSaveMode, estimatedCopyBytes, formatTimecode, keepLastRange, nearestKeyframe, validTrimRange } from '../shared/editor'
import type { SaveReason } from '../shared/editor'
import type { AudioTrackId } from '../shared/audioLanes'
import type { ClipInfo } from '../preload/preload'
import { createHistory, push, redo, undo } from '../shared/history'
import { createScrubSeekScheduler } from '../shared/scrubSeek'
import { loopPreviewTarget } from '../shared/loopPreview'
import { audioEditsPending } from '../shared/unsavedAudio'

type EditSnapshot = { trim: { inSec: number; outSec: number }; gains: Record<string, number> }

function sameEdit(a: EditSnapshot, b: EditSnapshot): boolean {
  return a.trim.inSec === b.trim.inSec && a.trim.outSec === b.trim.outSec &&
    Object.keys(a.gains).length === Object.keys(b.gains).length &&
    Object.keys(a.gains).every(id => a.gains[id] === b.gains[id])
}

const SPEEDS = [0.5, 1, 1.5, 2] as const

const SAVE_NOTES: Record<SaveReason, string> = {
  none: 'lossless',
  trim: 're-encodes the first second',
  audio: 're-encodes audio',
  video: 're-encodes video — colour changed',
}

// A finisher, not an editor: one clip in, one clip out. No browser chrome on
// this screen - no <video controls>, no <select>, no number spinners - because
// looking like Chrome is the thing it is here to stop doing.
export default function Editor({ clip, onClose }: { clip: ClipInfo; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scrubSeekRef = useRef<ReturnType<typeof createScrubSeekScheduler> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loopPreview, setLoopPreview] = useState(false)
  const [current, setCurrent] = useState(0)
  const playheadRef = useRef(0)
  const [duration, setDuration] = useState(clip.durationSec || 0)
  const [speed, setSpeed] = useState<number>(1)
  const [range, setRange] = useState({ inSec: 0, outSec: clip.durationSec || 0 })
  const [keyframes, setKeyframes] = useState<number[]>([])
  const [saturation, setSaturation] = useState(100)
  const [saving, setSaving] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  // Decoding walks the whole file, so the lanes arrive seconds after the
  // screen. Showing nothing while that happens reads as broken rather than
  // busy, so the mixer renders placeholder rows until the tracks land.
  const { tracks: audioTracks, loading: audioLoading, error: audioError } = useClipAudio(clip.filePath)
  const [gains, setGains] = useState<Record<string, number>>({})
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set())
  const snapshotRef = useRef<EditSnapshot>({ trim: range, gains: {} })
  const historyRef = useRef(createHistory(snapshotRef.current))
  const draggingEdit = useRef(false)
  const trimWrite = useRef(Promise.resolve())
  const trimWriteFailed = useRef(false)
  const initialisedTrim = useRef(false)
  const frameStepSec = useRef(1 / 60)
  const lastFrameTime = useRef<number | null>(null)
  const [mediaDuration, setMediaDuration] = useState(0)

  const showSnapshot = useCallback((snapshot: EditSnapshot) => {
    snapshotRef.current = snapshot
    setRange(snapshot.trim)
    setGains(snapshot.gains)
  }, [])

  const queueTrimWrite = useCallback((trim: EditSnapshot['trim']) => {
    const length = videoRef.current?.duration || duration
    trimWrite.current = trimWrite.current.then(async () => {
      const result = await window.flash?.setClipTrim(clip.filePath, trim, length)
      trimWriteFailed.current = !result || !!result.error
      if (trimWriteFailed.current) setSaveNote(`Could not save trim: ${result?.error ?? 'Save failed'}`)
    }).catch(() => { trimWriteFailed.current = true; setSaveNote('Could not save trim') })
  }, [clip.filePath, duration])

  const commit = useCallback(() => {
    if (!sameEdit(historyRef.current.present, snapshotRef.current)) {
      const before = historyRef.current.present.trim
      const after = snapshotRef.current.trim
      historyRef.current = push(historyRef.current, snapshotRef.current)
      if (before.inSec !== after.inSec || before.outSec !== after.outSec) {
        queueTrimWrite(after)
      }
    }
  }, [queueTrimWrite])

  const beginDrag = useCallback(() => { draggingEdit.current = true }, [])
  const endDrag = useCallback(() => { draggingEdit.current = false; commit() }, [commit])

  const closeEditor = useCallback(async () => {
    if (saving) return
    if (trimWriteFailed.current) { onClose(); return }
    if (draggingEdit.current) endDrag()
    await trimWrite.current
    if (!trimWriteFailed.current) onClose()
  }, [endDrag, onClose, saving])

  const changeTrim = useCallback((trim: EditSnapshot['trim'], record = true) => {
    showSnapshot({ ...snapshotRef.current, trim })
    if (record && !draggingEdit.current) commit()
  }, [showSnapshot, commit])

  const changeGain = useCallback((id: string, gain: number) => {
    showSnapshot({ ...snapshotRef.current, gains: { ...snapshotRef.current.gains, [id]: gain } })
    if (!draggingEdit.current) commit()
  }, [showSnapshot, commit])

  const setInitialTrim = useCallback((length: number) => {
    if (initialisedTrim.current || length <= 0 || historyRef.current.past.length || historyRef.current.future.length) return
    initialisedTrim.current = true
    const snapshot = { ...snapshotRef.current, trim: validTrimRange(clip.trim, length) ?? { inSec: 0, outSec: length } }
    showSnapshot(snapshot)
    historyRef.current = createHistory(snapshot)
  }, [clip.trim, showSnapshot])

  // Keyframes come from a full pass over the file, so they arrive a moment
  // after the screen does. Until then the strip simply has no ticks and no
  // snapping, which degrades quietly rather than blocking the editor.
  useEffect(() => {
    let cancelled = false
    window.flash?.getClipKeyframes(clip.filePath).then(result => {
      if (cancelled || !result || result.error) return
      setKeyframes(result.keyframesSec ?? [])
      if (result.durationSeconds > 0) {
        setDuration(current => current > 0 ? current : result.durationSeconds)
        setInitialTrim(result.durationSeconds)
      }
    })
    return () => { cancelled = true }
  }, [clip.filePath, setInitialTrim])

  useEffect(() => {
    const initial = { trim: { inSec: 0, outSec: clip.durationSec || 0 }, gains: {} }
    showSnapshot(initial)
    historyRef.current = createHistory(initial)
    draggingEdit.current = false
    initialisedTrim.current = false
    playheadRef.current = 0
    frameStepSec.current = 1 / 60
    setMediaDuration(0)
    setLoopPreview(false)
    setMutedTracks(new Set())
  }, [clip.filePath, showSnapshot])

  const liveGains = useMemo(() => Object.fromEntries(
    audioTracks.map(track => [track.id, mutedTracks.has(track.id) ? 0 : (gains[track.id] ?? 1)]),
  ), [audioTracks, gains, mutedTracks])
  const { ready: mixReady } = useLiveMix(videoRef, audioTracks, liveGains)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const scheduler = createScrubSeekScheduler(video, requestAnimationFrame, cancelAnimationFrame)
    scrubSeekRef.current = scheduler
    return () => {
      scrubSeekRef.current = null
      scheduler.dispose()
    }
  }, [clip.filePath])

  const seekTo = useCallback((seconds: number) => {
    scrubSeekRef.current?.request(seconds)
    playheadRef.current = seconds
    setCurrent(seconds)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !video.requestVideoFrameCallback) return
    let active = true
    const observe: VideoFrameRequestCallback = (_now, frame) => {
      if (!active) return
      const previous = lastFrameTime.current
      const difference = previous === null ? 0 : frame.mediaTime - previous
      if (difference > 0.004 && difference < 0.1) frameStepSec.current = difference
      lastFrameTime.current = frame.mediaTime
      video.requestVideoFrameCallback(observe)
    }
    video.requestVideoFrameCallback(observe)
    return () => { active = false; lastFrameTime.current = null }
  }, [clip.filePath])

  // The in-point counts as on a keyframe only when it lands exactly on one.
  // The native planner carries a half-frame tolerance of its own; this is
  // deliberately stricter so the badge never promises lossless and then costs
  // a re-encode.
  const saveMode = useMemo(
    () => deriveSaveMode(
      range.inSec === 0 || nearestKeyframe(keyframes, range.inSec, 0.001) !== null,
      Object.values(liveGains),
      saturation,
    ),
    [keyframes, range.inSec, liveGains, saturation])

  const save = useCallback(async () => {
    setSaving(true)
    setSaveNote(null)
    const gains = Object.fromEntries(
      audioTracks.map(track => [track.id, liveGains[track.id] ?? 1]),
    ) as Partial<Record<AudioTrackId, number>>
    try {
      await trimWrite.current
      if (trimWriteFailed.current) { setSaveNote('Could not save trim. Move a trim handle to try again.'); return }
      const result = await window.flash?.saveClipEdit(clip.filePath, {
        startSeconds: range.inSec,
        endSeconds: range.outSec,
        gains,
        saturation,
        reEncode: saveMode.reason === 'audio' || saveMode.reason === 'video',
      })
      if (!result || result.error) { setSaveNote(result?.error ?? 'Save failed'); return }
      // If smart render could not run, the native side falls back to a
      // keyframe-snapped cut. Say so rather than delivering a different clip than
      // the one on screen.
      const drift = result.actualStartSeconds !== undefined
        ? Math.abs(result.actualStartSeconds - range.inSec) : 0
      setSaveNote(drift > 0.05
        ? `Saved from ${formatTimecode(result.actualStartSeconds!)} — ${drift.toFixed(1)}s earlier than asked`
        : 'Saved alongside the original')
    } catch (error) {
      setSaveNote(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [audioTracks, liveGains, saturation, saveMode, clip.filePath, range])

  const grabFrame = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setSaveNote('Frame is not ready')
      return
    }

    setGrabbing(true)
    setSaveNote(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create screenshot canvas')
      const playheadSeconds = video.currentTime
      context.filter = `saturate(${saturation}%)`
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try { canvas.toBlob(resolve, 'image/png') }
        catch (error) { reject(error) }
      })
      if (!blob) throw new Error('Could not encode frame as PNG')
      const result = await window.flash?.saveClipFrame(
        clip.filePath, playheadSeconds, new Uint8Array(await blob.arrayBuffer()))
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save screenshot')
      setSaveNote('Frame saved alongside the original')
    } catch (error) {
      setSaveNote(error instanceof Error ? error.message : 'Could not grab frame')
    } finally {
      setGrabbing(false)
    }
  }, [clip.filePath, saturation])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => { /* autoplay policy */ })
    else video.pause()
  }, [])

  const setTrimEdge = useCallback((edge: 'in' | 'out', seconds: number, snap = true) => {
    const snapped = snap ? nearestKeyframe(keyframes, seconds, TRIM_SNAP_SEC) ?? seconds : seconds
    const current = snapshotRef.current.trim
    changeTrim(edge === 'in'
      ? clampRange(snapped, current.outSec, duration)
      : clampRange(current.inSec, snapped, duration))
  }, [duration, keyframes, changeTrim])

  // Keep the existing bracket and history shortcuts alongside editing keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const input = target instanceof HTMLInputElement ? target : null
      if (target && ((input && input.type !== 'range') || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable || target.closest('[contenteditable="true"]'))) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase()
        if (key === 'z' || key === 'y') {
          event.preventDefault()
          if (draggingEdit.current) endDrag()
          const next = key === 'y' || event.shiftKey ? redo(historyRef.current) : undo(historyRef.current)
          if (next !== historyRef.current) {
            const previousTrim = historyRef.current.present.trim
            historyRef.current = next
            showSnapshot(next.present)
            if (next.present.trim.inSec !== previousTrim.inSec || next.present.trim.outSec !== previousTrim.outSec) {
              queueTrimWrite(next.present.trim)
            }
          }
          return
        }
      }
      if (input) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Closing mid-save would unmount the editor while the native writer is
      // still producing the copy, leaving no visible result or error.
      if (event.key === 'Escape' && !saving) void closeEditor()
      if (event.code === 'Space') { event.preventDefault(); togglePlay() }
      if (event.key.toLowerCase() === 'p' && !event.repeat) {
        event.preventDefault()
        setLoopPreview(value => !value)
      }
      if (event.key === '[' || event.key === ']' || ['i', 'o'].includes(event.key.toLowerCase())) {
        const video = videoRef.current
        if (!video) return
        event.preventDefault()
        setTrimEdge(event.key === '[' || event.key.toLowerCase() === 'i' ? 'in' : 'out', video.currentTime,
          event.key === '[' || event.key === ']')
      }
      const key = event.key.toLowerCase()
      if (key === 'arrowleft' || key === 'j' || key === 'arrowright') {
        event.preventDefault()
        videoRef.current?.pause()
        seekTo(Math.min(duration, Math.max(0, (videoRef.current?.currentTime ?? playheadRef.current) +
          (key === 'arrowright' ? 1 : -1) * frameStepSec.current)))
      }
      if (key === 'k') { event.preventDefault(); videoRef.current?.pause() }
      if (key === 'l') { event.preventDefault(); videoRef.current?.play().catch(() => {}) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeEditor, saving, setTrimEdge, togglePlay, endDrag, showSnapshot, seekTo, duration, queueTrimWrite])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = speed
  }, [speed])

  const source = clipUrl(clip.filePath)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
      <ClipActionBar filePath={clip.filePath} onClose={() => { void closeEditor() }} backLabel="Back"
        unsavedAudio={audioEditsPending(audioTracks.map(track => track.id), liveGains)} middle={
        <span className="display truncate" style={{ fontSize: 24, color: 'var(--fg)' }}>{clipDisplayTitle(clip.title)}</span>
      } />

      <div className="flex-1 flex flex-col items-center gap-3 px-6 pt-3 pb-3 overflow-hidden min-h-0" aria-busy={audioTracks.length > 0 && !mixReady}>
        {/* The clip takes the room, the mixer sits beside it, and the strip
            runs the full width underneath, so the picture is the largest
            thing on the screen rather than a postcard above the controls. */}
        <div className="flex-1 w-full flex gap-6 min-h-0">
        {/* The preview takes whatever the strip, mixer and footer leave, so it
            grows with the window instead of leaving a band of dead space. */}
        <div className="flex-1 min-w-0 flex items-start justify-center min-h-0">
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          key={clip.filePath}
          src={source}
          muted
          style={{
            maxWidth: '100%', maxHeight: '100%', height: '100%', objectFit: 'contain', borderRadius: 4,
            // Omitted entirely at 100 rather than set to saturate(100%), so the
            // ordinary case costs the compositor nothing.
            filter: saturation === 100 ? undefined : `saturate(${saturation}%)`,
          }}
          onLoadedMetadata={event => {
            const actual = event.currentTarget.duration
            const length = Number.isFinite(actual) && actual > 0 ? actual : clip.durationSec || 0
            setDuration(length)
            setMediaDuration(Number.isFinite(actual) && actual > 0 ? actual : 0)
            setInitialTrim(length)
          }}
          onTimeUpdate={event => {
            const video = event.currentTarget
            const target = loopPreviewTarget(video.currentTime, range, loopPreview, !video.paused)
            if (target !== null) video.currentTime = target
            playheadRef.current = target ?? video.currentTime
            setCurrent(playheadRef.current)
          }}
          onPlay={event => {
            const video = event.currentTarget
            if (loopPreview && (video.currentTime < range.inSec || video.currentTime >= range.outSec)) {
              video.currentTime = range.inSec
            }
            setPlaying(true)
          }}
          onPause={() => setPlaying(false)}
          onEnded={event => {
            if (!loopPreview || !(range.outSec > range.inSec)) return
            event.currentTarget.currentTime = range.inSec
            void event.currentTarget.play().catch(() => {})
          }}
          onClick={togglePlay}
        />
        </div>

          <div className="flex flex-col justify-start shrink-0 overflow-y-auto" style={{ width: 360 }}>
            <h2 className="display" style={{ fontSize: 30, color: "var(--fg)", paddingBottom: 12 }}>Mix</h2>
        {/* A picture control, so it sits above the sound controls rather than
            among them - but on the same grid, so the stack reads as one. */}
        <div className="w-full overflow-hidden" style={{ maxWidth: 900, borderTop: '1px solid var(--edge-soft)', borderBottom: '1px solid var(--edge-soft)' }}>
          <div className="grid items-center gap-3 px-3" style={{ gridTemplateColumns: '32px 54px minmax(60px, 1fr) 88px 42px', minHeight: 48 }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-md"
              style={{ color: 'var(--fg)', border: '1px solid var(--line)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 1.8s4.2 4 4.2 6.7A4.2 4.2 0 018 12.7 4.2 4.2 0 013.8 8.5C3.8 5.8 8 1.8 8 1.8z" />
                <path d="M8 1.8v10.9" />
              </svg>
            </span>
            <span className="caps" style={{ color: 'var(--fg)', fontSize: 10.5 }}>
              colour
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted-3)' }}>
              {saturation === 100 ? 'unchanged' : 'saved copy re-encodes every frame'}
            </span>
            <input
              className="audio-gain-range"
              type="range"
              min={0}
              max={200}
              step={1}
              value={saturation}
              aria-label="Saturation"
              title="Double-click to reset"
              onDoubleClick={() => setSaturation(100)}
              onChange={event => setSaturation(event.currentTarget.valueAsNumber)}
              style={{ ['--filled' as string]: `${saturation / 2}%` }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {saturation}%
            </span>
          </div>
        </div>

        {audioError && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--alert)', padding: '8px 12px' }}>Audio unavailable</p>
        )}

        <AudioLanes
          loading={audioLoading}
          tracks={audioTracks}
          gains={gains}
          muted={mutedTracks}
          onGainChange={changeGain}
          onGainDragStart={beginDrag}
          onGainDragEnd={endDrag}
          onMuteToggle={id => setMutedTracks(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })}
        />

          </div>
        </div>

        <div className="w-full">
        <Filmstrip
          filePath={clip.filePath}
          durationSec={duration}
          inSec={range.inSec}
          outSec={range.outSec}
          currentSec={current}
          keyframesSec={keyframes}
          marksSec={clip.marksSec}
          onChange={next => changeTrim(clampRange(next.inSec, next.outSec, duration))}
          onDragStart={beginDrag}
          onDragEnd={endDrag}
          onScrub={seekTo}
        />

        </div>

        <div className="w-full flex items-center gap-3">
          <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
            className="w-8 h-8 flex items-center justify-center rounded-md transition-all hover:bg-white/5"
            style={{ color: 'var(--fg)' }}>
            {playing
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.8v10.4c0 .7.8 1.1 1.4.7l8-5.2a.85.85 0 000-1.4l-8-5.2c-.6-.4-1.4 0-1.4.7z"/></svg>}
          </button>

          <button onClick={() => setLoopPreview(value => !value)}
            aria-label="Loop trim preview" aria-pressed={loopPreview} title="Loop trim preview (P)"
            className="w-8 h-8 flex items-center justify-center rounded-md transition-all hover:bg-white/5"
            style={{ color: loopPreview ? 'var(--accent)' : 'var(--fg)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 6V4.5A2.5 2.5 0 0010.5 2h-6A2.5 2.5 0 002 4.5V6" />
              <path d="m11 4 2 2 2-2M3 10v1.5A2.5 2.5 0 005.5 14h6a2.5 2.5 0 002.5-2.5V10" />
              <path d="m5 12-2-2-2 2" />
            </svg>
          </button>

          <span style={{ fontSize: 12, color: 'var(--muted-2)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimecode(current)} <span style={{ color: 'var(--muted-3)' }}>/ {formatTimecode(duration)}</span>
          </span>

          {/* Preview only. Baking speed into the saved file means re-encoding
              and pitch-correcting three audio tracks, which is not what this
              screen is for. */}
          <span className="ml-auto flex items-center gap-4" role="group" aria-label="Preview speed">
            {SPEEDS.map(value => (
              <button key={value} onClick={() => setSpeed(value)}
                aria-pressed={speed === value}
                className="tab tabular">
                {value}x
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 px-6 shrink-0" style={{ height: 64, borderTop: '1px solid var(--edge-soft)' }}>
        <span className="display" style={{ fontSize: 26, color: 'var(--fg)' }}>
          {(range.outSec - range.inSec).toFixed(1)}s
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {[15, 30].map(seconds => duration > seconds && (
            <button key={seconds} className="btn btn-sm shrink-0" onClick={() => {
              const trim = keepLastRange(duration, seconds, keyframes, TRIM_SNAP_SEC)
              if (trim) changeTrim(trim)
            }}>
              Keep last {seconds}s
            </button>
          ))}
        </span>
        {saveMode.lossless && keyframes.length > 0 && estimatedCopyBytes(clip.size, mediaDuration, range) !== null &&
          <span className="tabular hidden min-[1100px]:inline" style={{ fontSize: 12, color: 'var(--muted)' }}>
            ~{(estimatedCopyBytes(clip.size, mediaDuration, range)! / (1024 * 1024)).toFixed(1)} MB approx.
          </span>}
        <span className="tabular" style={{ fontSize: 12, color: 'var(--muted)' }}>
          {formatTimecode(range.inSec)} → {formatTimecode(range.outSec)}
        </span>
        <span className="hidden min-[1100px]:flex items-center gap-2" style={{ fontSize: 12, color: 'var(--muted-3)' }}>
          <span className="keycap">[</span> in <span className="keycap">]</span> out
        </span>
        {/* Honest about what the save will cost, and specific about which
            change caused it, rather than just going dark. */}
        <span className="hidden min-[1100px]:inline" style={{ fontSize: 12, color: saveMode.lossless ? 'var(--fg)' : 'var(--muted-3)' }}>
          {SAVE_NOTES[saveMode.reason]}
        </span>
        {saveNote && <span role="status" className="min-w-0 truncate" title={saveNote} style={{ fontSize: 12, color: 'var(--muted)' }}>{saveNote}</span>}
        <span className="ml-auto flex items-center gap-2">
          {clip.kind !== 'shot' && (
            <button disabled={grabbing} onClick={grabFrame} className="btn shrink-0">
              {grabbing ? 'Saving…' : 'Grab frame'}
            </button>
          )}
          <button
            disabled={saving || !(range.outSec > range.inSec)}
            onClick={save}
            className="btn btn-solid">
            {saving ? 'Saving…' : 'Save a copy'}
          </button>
        </span>
      </div>
    </div>
  )
}
