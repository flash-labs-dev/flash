import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clipUrl } from '../shared/editor'
import { clipDisplayTitle } from '../shared/clipTitle'
import { type Clip, GameMark, Icon, RenameTitle, formatBytes } from './ui'

// The clip viewer from docs/flash-ui-handoff (Viewer): back to the library,
// the player with its own control bar, and a details panel on the right.
// Same props as the old full-bleed FeedView, so App swaps one for the other.
// shortcut: no trim panel, tags or notes yet; trimming lives in the editor
// ("Edit clip") and tags/notes have no storage behind them.

function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function captured(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle, var(--edge))' }}>
      <dt style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</dt>
      <dd className="tabular" style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--fg)', textAlign: 'right' }}>{value}</dd>
    </div>
  )
}

export function FeedView({ clips, currentPath, onPathChange, onOpenLibrary, onDelete, onEdit, onRename, onStar, filterLabel, filtered, onClearFilters,
  hotkey, bufferLength }: {
  clips: Clip[]
  currentPath: string
  onPathChange: (path: string) => void
  filterLabel: string
  onOpenLibrary: () => void
  onClearFilters: () => void
  filtered: boolean
  onDelete: (clip: Clip) => void
  onEdit: (clip: Clip) => void
  onRename: (clip: Clip, name: string) => Promise<string | null>
  onStar: (clip: Clip) => void
  isRecording: boolean
  captureAvailable: boolean
  hotkey: string
  bufferLength: number
  onToggleRecording: () => void
}) {
  const found = clips.findIndex(clip => clip.filePath === currentPath)
  const index = found >= 0 ? found : clips.length ? 0 : -1
  const clip = index >= 0 ? clips[index] : undefined
  const isShot = clip?.kind === 'shot'
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [note, setNote] = useState<string | null>(null)

  const go = useCallback((step: number) => {
    const next = clips[index + step]
    if (next) onPathChange(next.filePath)
  }, [clips, index, onPathChange])

  useEffect(() => { setNote(null); setTime(0); setDuration(0) }, [clip?.filePath])
  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume }, [volume, clip?.filePath])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {}); else video.pause()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
      else if (event.key === ' ') { event.preventDefault(); toggle() }
      else if (event.key === 'Delete' && clip) { event.preventDefault(); onDelete(clip) }
      else if (event.key === 'Escape') onOpenLibrary()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, toggle, clip, onDelete, onOpenLibrary])

  const grabFrame = useCallback(async () => {
    const video = videoRef.current
    if (!clip || !video || !video.videoWidth) { setNote('Frame is not ready'); return }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode the frame')
      const result = await window.flash?.saveClipFrame(clip.filePath, video.currentTime, new Uint8Array(await blob.arrayBuffer()))
      setNote(result?.error ?? 'Frame saved next to the clip')
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not grab the frame')
    }
  }, [clip])

  const copy = useCallback(async () => {
    if (!clip) return
    setNote(await window.flash?.copyClipFile(clip.filePath) ? 'Copied. Paste it into Discord or a folder.' : 'Could not copy the clip')
  }, [clip])

  if (!clip) {
    return (
      <div className="absolute flex flex-col items-center justify-center text-center" style={{ inset: 0, gap: 12, color: 'var(--muted)' }}>
        <Icon name="scissors" size={40} />
        <p style={{ fontSize: 16, color: 'var(--fg)' }}>No clips yet</p>
        <p style={{ fontSize: 13 }}>Press {hotkey} in a game to save the last {bufferLength} seconds.</p>
        <button className="btn" onClick={onOpenLibrary}>Back to library</button>
      </div>
    )
  }

  const src = clipUrl(clip.filePath)
  const action = (icon: React.ComponentProps<typeof Icon>['name'], label: string, onClick: () => void, extra?: React.CSSProperties) => (
    <button className="btn justify-start" onClick={onClick} style={{ width: '100%', ...extra }}>
      <Icon name={icon} size={16} /> {label}
    </button>
  )

  return (
    <div className="absolute flex" style={{ inset: 0, padding: 24, gap: 24 }}>
      <div className="flex flex-col flex-1 min-w-0" style={{ gap: 14 }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <button className="btn btn-sm" onClick={onOpenLibrary}><Icon name="left" size={14} /> Library</button>
          {filtered && (
            <span className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'var(--muted)' }}>
              {filterLabel}<button className="btn btn-sm" onClick={onClearFilters}>Show all</button>
            </span>
          )}
          <span className="ml-auto flex items-center tabular" style={{ gap: 10, fontSize: 12, color: 'var(--text-faint, var(--muted))' }}>
            <span className="chip-key">←</span><span className="chip-key">→</span> switch clips
            <span style={{ marginLeft: 8 }}>{index + 1} of {clips.length}</span>
          </span>
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden" style={{ borderRadius: 8, background: '#000', border: '1px solid var(--border-subtle, var(--edge))' }}>
          <div className="relative flex-1 min-h-0 flex items-center justify-center" onClick={isShot ? undefined : toggle} style={{ cursor: isShot ? 'default' : 'pointer' }}>
            {isShot
              ? <img src={src} alt={clip.title} className="max-w-full max-h-full object-contain" />
              : <video key={clip.filePath} ref={videoRef} src={src} autoPlay playsInline className="max-w-full max-h-full"
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                  onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                  onEnded={() => setPlaying(false)} />}
          </div>
          {!isShot && (
            <div className="flex items-center" style={{ gap: 12, padding: '10px 14px', background: 'var(--panel)', borderTop: '1px solid var(--border-subtle, var(--edge))' }}>
              <button className="win-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
              <span className="tabular" style={{ fontSize: 12, color: 'var(--muted)', minWidth: 76 }}>{timecode(time)} / {timecode(duration || clip.durationSec)}</span>
              <input type="range" aria-label="Seek" className="viewer-range flex-1" min={0} max={duration || clip.durationSec || 1} step={0.01} value={time}
                style={{ '--fill': `${Math.min(100, (time / (duration || clip.durationSec || 1)) * 100)}%` } as React.CSSProperties}
                onChange={e => { const v = Number(e.target.value); setTime(v); if (videoRef.current) videoRef.current.currentTime = v }} />
              <button className="win-btn" aria-label={volume ? 'Mute' : 'Unmute'} onClick={() => setVolume(v => v ? 0 : 0.8)}><Icon name={volume ? 'volume' : 'mute'} size={16} /></button>
              <input type="range" aria-label="Volume" className="viewer-range" style={{ width: 80, '--fill': `${volume * 100}%` } as React.CSSProperties} min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(Number(e.target.value))} />
              <button className="win-btn" aria-label="Full screen" onClick={() => void videoRef.current?.requestFullscreen?.()}><Icon name="grid" size={16} /></button>
            </div>
          )}
        </div>
      </div>

      <aside className="flex flex-col shrink-0 overflow-y-auto" style={{ width: 340, gap: 18, padding: 20, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-subtle, var(--edge))' }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Title</span>
          <RenameTitle title={clip.title} display={clipDisplayTitle(clip.title)} onCommit={name => onRename(clip, name)} style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.3 }} />
        </div>

        <dl className="flex flex-col" style={{ margin: 0, borderTop: '1px solid var(--border-subtle, var(--edge))' }}>
          <Stat label="Captured" value={captured(clip.createdAt)} />
          <Stat label="Length" value={isShot ? 'Screenshot' : clip.duration} />
          <Stat label="Size" value={formatBytes(clip.size)} />
        </dl>

        <div className="flex flex-col" style={{ gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Game</span>
          <span className="flex items-center" style={{ gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>
            <GameMark game={clip.game} size={22} /> {clip.game}
          </span>
        </div>

        <div className="flex flex-col mt-auto" style={{ gap: 8 }}>
          {note && <p role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>{note}</p>}
          {action('copy', 'Copy clip', copy, { background: 'var(--fg)', color: 'var(--bg)', borderColor: 'var(--fg)' })}
          {!isShot && action('edit', 'Edit clip', () => onEdit(clip))}
          {!isShot && action('camera', 'Grab frame', grabFrame)}
          {action('star', clip.starred ? 'Remove from favorites' : 'Favorite', () => onStar(clip))}
          {action('folder', 'Show in folder', () => void window.flash?.showClipInFolder(clip.filePath))}
          {action('trash', 'Delete', () => onDelete(clip), { color: 'var(--danger-text, var(--alert))' })}
        </div>
      </aside>
    </div>
  )
}
