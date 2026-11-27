import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clipUrl } from '../shared/editor'
import { clipDisplayTitle } from '../shared/clipTitle'
import { Dropdown } from './Dropdown'
import { DEFAULT_EXPORT_LIMIT, EXPORT_LIMITS, codecNote, findExportLimit } from '../shared/exportLimits'
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
  const [busy, setBusy] = useState<'share' | 'export' | null>(null)
  const [link, setLink] = useState<{ url: string; days: number } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportLimit, setExportLimit] = useState(DEFAULT_EXPORT_LIMIT)

  const go = useCallback((step: number) => {
    const next = clips[index + step]
    if (next) onPathChange(next.filePath)
  }, [clips, index, onPathChange])

  useEffect(() => { setNote(null); setTime(0); setDuration(0); setLink(null); setExportOpen(false) }, [clip?.filePath])
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
      // While the link dialog or export menu is up, keys must not move between clips.
      if (link || exportOpen) { if (event.key === 'Escape') { setLink(null); setExportOpen(false) } return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
      else if (event.key === ' ') { event.preventDefault(); toggle() }
      else if (event.key === 'Delete' && clip) { event.preventDefault(); onDelete(clip) }
      else if (event.key === 'Escape') onOpenLibrary()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, toggle, clip, onDelete, onOpenLibrary, link, exportOpen])

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

  // Uploads the clip and copies a link that works for a few days (Discord embeds it).
  const share = useCallback(async () => {
    if (!clip) return
    setBusy('share'); setNote(null)
    try {
      const result = await window.flash?.shareClipLink(clip.filePath)
      if (result?.ok) { setLinkCopied(false); setLink({ url: result.url, days: result.days }) }
      else setNote(result?.error ?? 'Could not make a link')
    } catch { setNote('Could not make a link') } finally { setBusy(null) }
  }, [clip])

  // A smaller sibling that fits an upload limit; it re-encodes, so it takes seconds.
  const exportCopy = useCallback(async () => {
    if (!clip) return
    setBusy('export'); setNote(null); setExportOpen(false)
    const limit = findExportLimit(exportLimit)
    try {
      const result = await window.flash?.exportClip(clip.filePath, limit.bytes, limit.codec)
      if (!result || result.error) { setNote(result?.error ?? 'Export failed'); return }
      const fallback = codecNote(limit.codec, result.codec)
      setNote(`Shareable copy saved: ${formatBytes(result.bytes ?? 0)} at ${result.height}p${fallback ? `. ${fallback}` : ''}`)
    } catch (error) { setNote(error instanceof Error ? error.message : 'Export failed') } finally { setBusy(null) }
  }, [clip, exportLimit])

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
    <div className="absolute flex" style={{ inset: 0, padding: 16, gap: 16 }}>
      {link && (
        <div role="dialog" aria-label="Clip link" className="absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 50, background: 'rgba(0,0,0,0.6)' }} onClick={() => setLink(null)}>
          <div onClick={e => e.stopPropagation()} className="flex flex-col" style={{ gap: 12, width: 420, maxWidth: '90%', padding: 20, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--edge)' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>Link ready</div>
            <input readOnly value={link.url} onFocus={e => e.currentTarget.select()} className="field" style={{ width: '100%', height: 36, padding: '0 12px' }} />
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Already copied to your clipboard. Works for {link.days} days.</div>
            <div className="flex justify-end" style={{ gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setLink(null)}>Close</button>
              <button className="btn btn-sm btn-solid" onClick={async () => {
                try { await navigator.clipboard.writeText(link.url); setLinkCopied(true) } catch { setLinkCopied(false) }
              }}>{linkCopied ? 'Copied' : 'Copy link'}</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col flex-1 min-w-0" style={{ gap: 14 }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <button className="btn btn-sm" onClick={onOpenLibrary}><Icon name="left" size={14} /> Library</button>
          {filtered && (
            <span className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'var(--muted)' }}>
              {filterLabel}<button className="btn btn-sm" onClick={onClearFilters}>Show all</button>
            </span>
          )}
        </div>

        {/* The player keeps the clip's 16:9 shape, so the video fills it with no black bars. */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="viewer-player relative flex flex-col overflow-hidden" style={{ width: '100%', maxHeight: '100%', borderRadius: 10, background: '#000', border: '1px solid var(--border-subtle, var(--edge))' }}>
          <div className="relative flex items-center justify-center" onClick={isShot ? undefined : toggle} style={{ aspectRatio: '16 / 9', minHeight: 0, flexShrink: 1, cursor: isShot ? 'default' : 'pointer' }}>
            {clips.length > 1 && <span className="viewer-count tabular">{index + 1} / {clips.length}</span>}
            {index > 0 && (
              <button className="viewer-nav" style={{ left: 12 }} aria-label="Previous clip" title="Previous clip (←)"
                onClick={e => { e.stopPropagation(); go(-1) }}><Icon name="left" size={20} /></button>
            )}
            {index < clips.length - 1 && (
              <button className="viewer-nav" style={{ right: 12 }} aria-label="Next clip" title="Next clip (→)"
                onClick={e => { e.stopPropagation(); go(1) }}><span style={{ display: 'flex', transform: 'scaleX(-1)' }}><Icon name="left" size={20} /></span></button>
            )}
            {isShot
              ? <img src={src} alt={clip.title} className="w-full h-full object-contain" />
              : <video key={clip.filePath} ref={videoRef} src={src} autoPlay playsInline className="w-full h-full object-contain"
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
      </div>

      <aside className="flex flex-col shrink-0 overflow-y-auto" style={{ width: 288, gap: 18, padding: 20, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-subtle, var(--edge))' }}>
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
          {/\.mp4$/i.test(clip.filePath) && action('link', busy === 'share' ? 'Uploading…' : 'Share clip', share, { background: 'var(--fg)', color: 'var(--bg)', borderColor: 'var(--fg)' })}
          {action('copy', 'Copy clip', copy)}
          {!isShot && (
            <div className="relative">
              {action('download', busy === 'export' ? 'Exporting…' : 'Export', () => setExportOpen(open => !open))}
              {exportOpen && (
                <div className="absolute flex flex-col" style={{ bottom: 42, left: 0, right: 0, gap: 8, padding: 12, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--edge)', boxShadow: '0 12px 32px rgba(0,0,0,.45)', zIndex: 20 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Fit under</span>
                  <Dropdown label="Upload limit" value={exportLimit} onChange={setExportLimit} options={EXPORT_LIMITS} width={276} />
                  <button className="btn btn-solid btn-sm" onClick={() => void exportCopy()}>Export copy</button>
                </div>
              )}
            </div>
          )}
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
