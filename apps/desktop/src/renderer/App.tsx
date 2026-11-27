import { usePlaybackVisibility } from './usePlaybackVisibility'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { DEFAULT_THEME } from '../shared/themes'
import { DEFAULT_AUDIO_LANES } from '../shared/audioLanes'
import { clipUrl, matchesQuery } from '../shared/editor'
import type { AutostartState } from '../preload/preload'
import { clearSelection, selectRange, toggleSelection } from '../shared/selection'
import { SelectionBar } from './SelectionBar'
import Editor from './Editor'
import { FeedView } from './ClipViewer'
import { LibraryView, sortClips, type SortOrder } from './LibraryView'
import { SettingsView, FeedbackDialog, type CaptureHealth, type Display, type Settings, type VoiceStatus } from './SettingsView'
import { SharedClipView, type SharedClipLink } from './SharedClipView'
import {
  type Clip, type ConfirmRequest, ConfirmDialog, BoltLogo, GameMark, Icon, formatBytes,
} from './ui'

/* THESIS: one clip owns the window and the next is one flick away; Flash
   refuses the dark-dashboard card grid every clipper ships.
   OWN-WORLD: near-black ground, white outlined glyphs, a soft bottom scrim,
   one plain Geist face for titles and text, tracked small caps for labels,
   and the theme accent only on live or engaged state.
   STORY: open Flash, the newest moment is already playing; flick through,
   star the keepers, edit or export one, find the rest in the library.
   FIRST VIEWPORT: the latest clip full-bleed; game and huge title low-left
   with Edit / Grab frame / Export; action rail right; transport along the
   bottom edge; title bar floating over the top scrim.
   FORM: full-bleed vertical media feed (challenger, chosen by the owner),
   seed f314f4ea.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the
   finish review, the verdict, and DESIGN.md */

type View = 'Feed' | 'Library' | 'Settings' | 'Shared'

// ── Window Controls ───────────────────────────────────────────────────────────

// Drawn in React rather than via Electron's titleBarOverlay, which paints native
// buttons on top of whatever the app puts in its own top-right corner.
function WindowControls() {
  const Button = ({ label, onClick, path, danger }: { label: string; onClick: () => void; path: string; danger?: boolean }) => (
    <button aria-label={label} title={label} onClick={onClick} className={`win-btn${danger ? ' win-btn-close' : ''}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  )

  return (
    <div className="flex items-center gap-1 titlebar-no-drag" style={{ paddingRight: 10 }}>
      <Button label="Minimize" onClick={() => window.flash?.minimize()} path="M0 5h10" />
      <Button label="Maximize" onClick={() => window.flash?.maximize()} path="M1 1h8v8h-8z" />
      <Button label="Close to tray" onClick={() => window.flash?.close()} path="M1 1l8 8M9 1l-8 8" danger />
    </div>
  )
}

// ── Title bar ─────────────────────────────────────────────────────────────────

const TITLE_HEIGHT = 56
const SIDEBAR_WIDTH = 232

// "Shift+F8" -> separate chips, as the spec draws key combos.
function KeyChips({ combo }: { combo: string }) {
  return <span className="flex items-center gap-1">{combo.split('+').map(key => <kbd key={key} className="chip-key">{key}</kbd>)}</span>
}

function IconButton({ label, icon, onClick, disabled }: { label: string; icon: React.ComponentProps<typeof Icon>['name']; onClick?: () => void; disabled?: boolean }) {
  return (
    <button aria-label={label} title={disabled ? `${label}: not available yet` : label} onClick={onClick} disabled={disabled}
      className="flex items-center justify-center titlebar-no-drag"
      style={{ width: 40, height: 40, borderRadius: 6, color: 'var(--text-faint)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <Icon name={icon} />
    </button>
  )
}

type UpdateState = { status: 'idle' | 'downloading' | 'ready'; version?: string }

// The bell: update notices for now. A dot means there is something to read.
function Notices({ update }: { update: UpdateState }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [open])
  const unread = update.status !== 'idle'
  return (
    <div ref={box} className="relative titlebar-no-drag">
      <button aria-label={unread ? 'Notifications, 1 new' : 'Notifications'} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="win-btn relative" style={{ width: 40, height: 40 }}>
        <Icon name="bell" />
        {unread && <span aria-hidden="true" style={{ position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 99, background: 'var(--accent)' }} />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute"
          style={{ right: 0, top: 44, width: 290, padding: 14, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--edge)', boxShadow: '0 12px 32px rgba(0,0,0,.45)', zIndex: 50 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Notifications</div>
          {update.status === 'ready' ? (
            <div className="flex flex-col" style={{ gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--fg)' }}>Flash {update.version ?? 'update'} is ready to install.</span>
              <button className="btn btn-solid btn-sm" onClick={() => window.flash?.installUpdate()}>Restart to update</button>
            </div>
          ) : update.status === 'downloading' ? (
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Downloading an update{update.version ? ` (${update.version})` : ''}…</span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>You're up to date. Update notices will show up here.</span>
          )}
        </div>
      )}
    </div>
  )
}

function TitleBar({ isRecording, onToggleRecording, detectedGame, captureAvailable, hotkey, hotkeyShort, saveState, onFeedback, update }: {
  onFeedback: () => void
  isRecording: boolean
  onToggleRecording: () => void
  detectedGame: string | null
  captureAvailable: boolean
  hotkey: string
  hotkeyShort: string
  saveState: { saving: boolean; error?: string }
  update: UpdateState
}) {
  const live = captureAvailable && isRecording
  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center gap-4 titlebar-drag"
      style={{ height: TITLE_HEIGHT, padding: '0 0 0 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2" style={{ width: SIDEBAR_WIDTH - 32 }}>
        <span style={{ color: 'var(--fg)', display: 'flex' }}><BoltLogo size={20} /></span>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>Flash</span>
      </div>

      {/* Status pill: also the button that starts and stops the replay buffer. */}
      <button onClick={onToggleRecording} disabled={!captureAvailable} aria-pressed={live}
        className="flex items-center gap-2 titlebar-no-drag"
        title={captureAvailable ? (live ? 'Replay buffer is running. Click to stop.' : 'Start the replay buffer') : 'Capture engine unavailable'}
        style={{
          height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 500,
          color: live ? 'var(--fg)' : 'var(--text-secondary)', background: 'var(--field)', border: '1px solid var(--edge)',
          cursor: captureAvailable ? 'pointer' : 'default',
        }}>
        {live ? <>{detectedGame && <GameMark game={detectedGame} size={18} />}Buffering{detectedGame && <span style={{ color: 'var(--muted)' }}>{detectedGame}</span>}</> : 'Not recording'}
      </button>

      <div className="flex items-center gap-4" style={{ fontSize: 13, color: 'var(--muted)' }}>
        {hotkey && <span className="flex items-center gap-2"><KeyChips combo={hotkey} />Save clip</span>}
        {hotkeyShort && <span className="flex items-center gap-2"><KeyChips combo={hotkeyShort} />Short clip</span>}
      </div>

      <div className="ml-auto flex items-center titlebar-no-drag">
        {saveState.saving && <span role="status" style={{ fontSize: 13, color: 'var(--fg)', marginRight: 12 }}>Saving clip</span>}
        {saveState.error && !saveState.saving && (
          <span role="alert" title={saveState.error}
            style={{ fontSize: 12, color: 'var(--alert)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 }}>
            {saveState.error}
          </span>
        )}
        <button onClick={onFeedback} className="titlebar-no-drag" style={{ fontSize: 13, color: 'var(--text-faint)', padding: '0 10px', height: 40, cursor: 'pointer' }}
          title="Tell us what's broken or what you want. We read every message.">Feedback</button>
        <Notices update={update} />
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--edge)', margin: '0 8px' }} />
        <WindowControls />
      </div>
    </header>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export type NavTarget = 'Library' | 'Games' | 'Favorites' | 'Screenshots' | 'Recordings' | 'Trash' | 'Settings'

function Sidebar({ active, onNavigate, storage }: {
  active: NavTarget | null
  onNavigate: (target: NavTarget) => void
  storage: { used: number; clips: number; total?: number }
}) {
  const Item = ({ target, icon }: { target: NavTarget; icon: React.ComponentProps<typeof Icon>['name'] }) => (
    <button onClick={() => onNavigate(target)} aria-current={active === target ? 'page' : undefined}
      className="flex items-center gap-3 w-full"
      style={{
        height: 36, padding: '0 10px', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: 'pointer',
        color: active === target ? 'var(--fg)' : 'var(--text-secondary)',
        background: active === target ? 'var(--hover)' : 'transparent',
      }}>
      <span style={{ display: 'flex', color: active === target ? 'var(--fg)' : 'var(--text-faint)' }}><Icon name={icon} size={18} /></span>{target}
    </button>
  )
  return (
    <nav aria-label="Main" className="absolute left-0 bottom-0 flex flex-col gap-0.5"
      style={{ top: TITLE_HEIGHT, width: SIDEBAR_WIDTH, padding: '10px 10px 12px', background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>
      <Item target="Library" icon="grid" />
      <Item target="Games" icon="gamepad" />
      <Item target="Favorites" icon="star" />
      <Item target="Screenshots" icon="camera" />
      <Item target="Recordings" icon="video" />
      <Item target="Trash" icon="trash" />
      <div className="flex items-center justify-between" style={{ padding: '16px 6px 4px 10px', fontSize: 12, fontWeight: 500, color: 'var(--text-faint)' }}>
        Albums
        {/* TODO: albums have no backend yet. */}
        <IconButton label="New album" icon="plus" disabled />
      </div>
      <div className="mt-auto flex flex-col gap-2" style={{ padding: '0 10px 10px' }}>
        <div className="flex items-center justify-between" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
          Storage
          <button onClick={() => onNavigate('Settings')} style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer' }}>Manage</button>
        </div>
        {storage.total ? (
          <div role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={storage.total} aria-valuenow={storage.used}
            style={{ height: 6, borderRadius: 3, background: 'var(--field)' }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--fg)', width: `${Math.min(100, storage.used / storage.total * 100)}%` }} />
          </div>
        ) : null /* TODO: the main process does not report disk capacity yet, so no fill bar. */}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {formatBytes(storage.used)}{storage.total ? ` of ${formatBytes(storage.total)}` : ''} used
        </div>
      </div>
      <Item target="Settings" icon="settings" />
    </nav>
  )
}

function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--fg)', padding: '20px 24px 0' }}>{children}</h1>
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  usePlaybackVisibility()
  const [view, setView] = useState<View>('Library')
  // Which sidebar page the Library view shows, and the two pages that are not clip grids.
  const [page, setPage] = useState<'Library' | 'Favorites' | 'Screenshots' | 'Recordings' | 'Games' | 'Trash'>('Library')
  const [sharedClip, setSharedClip] = useState<SharedClipLink | null>(null)
  const [gameFilter, setGameFilter] = useState('All')
  const [starredOnly, setStarredOnly] = useState(false)
  const [clipQuery, setClipQuery] = useState('')
  const [sort, setSort] = useState<SortOrder>('Recent')
  const [feedPath, setFeedPath] = useState('')
  const [editingClip, setEditingClip] = useState<Clip | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [detectedGame, setDetectedGame] = useState<string | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchor = useRef<string | null>(null)
  const [storage, setStorage] = useState({ used: 0, clips: 0 })
  const [settings, setSettings] = useState<Settings>({
    clipsFolder: '', theme: DEFAULT_THEME, hotkey: 'F8', hotkeyShort: 'Shift+F8', screenshotHotkey: 'F9',
    shortClipSeconds: 15, displayId: 0, captureMode: 'game', overlay: true, overlayPosition: 'top-left',
    voiceEnabled: false, voicePhrase: '', voiceRawFloor: 0.5, voiceCooldownMs: 3000,
    quality: '1080p 60fps', bufferLength: 30,
    audioCapture: true, audioLanes: DEFAULT_AUDIO_LANES, micDeviceId: '', autoSave: true, notifications: true, discordPresence: true, autoDeleteDays: 0,
    perGame: {},
  })
  const [encoder, setEncoder] = useState('none')
  const [captureBackend, setCaptureBackend] = useState('unknown')
  const [captureAvailable, setCaptureAvailable] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [autostart, setAutostart] = useState<AutostartState>(
    { enabled: false, managedByWindows: false, supported: false })
  // Re-read every time Settings is opened. Windows can have been changed
  // underneath us since the app started - Task Manager's Startup tab is one
  // click away - and a toggle showing a cached answer is a toggle that lies.
  useEffect(() => {
    if (view === 'Settings') window.flash?.getAutostart().then(setAutostart)
  }, [view])

  const toggleAutostart = useCallback(async () => {
    const next = await window.flash?.setAutostart(!autostart.enabled)
    if (next) setAutostart(next)
  }, [autostart.enabled])

  // All three keys, so a secondary hotkey lost to another app is visible in
  // Settings instead of looking fine and doing nothing.
  const [hotkeysRegistered, setHotkeysRegistered] = useState(
    { hotkey: '', clip: true, short: true, screenshot: true })
  const [health, setHealth] = useState<CaptureHealth | null>(null)
  const [learnedGames, setLearnedGames] = useState<Record<string, string>>({})
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    available: false,
    language: '',
    error: 'Checking voice activation…',
  })

  // Poll only while Settings is open — a background timer for a panel nobody is
  // looking at is exactly the kind of idle cost this app exists to avoid.
  const settingsPollBusy = useRef(false)
  useEffect(() => {
    if (view !== 'Settings' || !window.flash) return
    let cancelled = false
    const read = async () => {
      if (settingsPollBusy.current) return
      settingsPollBusy.current = true
      try {
        let captureStatus: any = null
        try {
          captureStatus = await window.flash!.capture.getStatus()
        } catch (error) {
          console.error('Could not read capture status', error)
        }
        const voice = await window.flash!.getVoiceStatus().catch(error => {
          console.error('Could not read voice status', error)
          return null
        })
        if (cancelled) return
        if (voice) setVoiceStatus(voice)
        if (!captureStatus) {
          setHealth({ healthy: false, fps: 0, buffered: 0, error: 'Capture unavailable' })
          return
        }
        const s: any = captureStatus
        setHealth({
          healthy: s.captureHealthy !== false && s.recording !== false,
          fps: s.lastIntervalMs > 0 ? 1000 / s.lastIntervalMs : 0,
          buffered: s.bufferSeconds ?? 0,
          audioMode: s.audioMode,
          error: s.captureError,
        })
        if (s.encoder) setEncoder(s.encoder)
        if (s.captureBackend) setCaptureBackend(s.captureBackend)
      } catch (error) {
        console.error('Could not read capture status', error)
        if (!cancelled) setHealth({ healthy: false, fps: 0, buffered: 0, error: 'Capture unavailable' })
      } finally {
        settingsPollBusy.current = false
      }
    }
    read()
    const timer = setInterval(read, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [view])
  const [displays, setDisplays] = useState<Display[]>([])
  // A monitor can be plugged in or removed while Flash sits in the tray, so
  // re-read the list whenever the Settings panel opens.
  useEffect(() => {
    if (view !== 'Settings') return
    window.flash?.capture?.listDisplays?.()?.then(setDisplays)
  }, [view])
  const [saveState, setSaveState] = useState<{ saving: boolean; error?: string }>({ saving: false })

  // The theme is a data attribute on <html>; index.css keys every palette off it.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Save errors are transient — clear them rather than leaving a stale banner.
  useEffect(() => {
    if (!saveState.error) return
    const timer = setTimeout(() => setSaveState(s => ({ ...s, error: undefined })), 6000)
    return () => clearTimeout(timer)
  }, [saveState.error])

  const refreshClipsRequest = useRef(0)
  const refreshClips = useCallback(async () => {
    if (!window.flash) return
    const requestId = ++refreshClipsRequest.current
    try {
      const [clipList, storageInfo] = await Promise.all([
        window.flash.getClips(),
        window.flash.getStorage(),
      ])
      if (requestId !== refreshClipsRequest.current) return
      setClips(clipList)
      setStorage(storageInfo)
    } catch (error) {
      console.error('Could not refresh clips', error)
    }
  }, [])

  // Build game list from actual clips
  const games = Array.from(
    clips.reduce((map, clip) => {
      map.set(clip.game, (map.get(clip.game) ?? 0) + 1)
      return map
    }, new Map<string, number>())
  ).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const allGames = clips.length > 0 ? [{ name: 'All', count: clips.length }, ...games] : []

  // One list drives both the feed and the library, so the clip after this one
  // in the feed is the tile after it in the grid.
  const shownClips = useMemo(() => {
    const byGame = gameFilter === 'All' ? clips : clips.filter(c => c.game === gameFilter)
    const byStar = starredOnly ? byGame.filter(c => c.starred) : byGame
    // shortcut: clips only come as 'clip' or 'shot' today, so Recordings is always empty until long recordings exist.
    const byKind = page === 'Screenshots' ? byStar.filter(c => c.kind === 'shot') : page === 'Recordings' ? [] : byStar
    const byQuery = clipQuery ? byKind.filter(clip => matchesQuery(clip, clipQuery)) : byKind
    return sortClips(byQuery, sort)
  }, [clips, gameFilter, starredOnly, clipQuery, sort, page])
  const filtered = gameFilter !== 'All' || starredOnly || clipQuery !== ''
  const filterLabel = [
    gameFilter === 'All' ? 'All games' : gameFilter,
    starredOnly ? 'Starred' : '',
    clipQuery ? `“${clipQuery}”` : '',
  ].filter(Boolean).join(' · ')
  const selectedClips = useMemo(() => clips.filter(clip => selectedIds.has(clip.id)), [clips, selectedIds])

  const clearFilters = useCallback(() => {
    setGameFilter('All'); setStarredOnly(false); setClipQuery('')
  }, [])

  const clearSelected = useCallback(() => {
    selectionAnchor.current = null
    setSelectedIds(clearSelection())
  }, [])

  const toggleSelected = useCallback((id: string) => {
    selectionAnchor.current = id
    setSelectedIds(selected => toggleSelection(selected, id))
  }, [])

  const selectDisplayedRange = useCallback((displayedIds: readonly string[], targetId: string) => {
    const previousAnchor = selectionAnchor.current
    const anchor = previousAnchor && displayedIds.includes(previousAnchor) ? previousAnchor : targetId
    if (anchor !== previousAnchor) selectionAnchor.current = anchor
    setSelectedIds(selected => selectRange(selected, displayedIds, anchor, targetId))
  }, [])

  const selectAllDisplayed = useCallback((displayedIds: readonly string[]) => {
    selectionAnchor.current = displayedIds[0] ?? null
    setSelectedIds(new Set(displayedIds))
  }, [])

  // A rename, delete or move changes IDs because IDs are paths. Drop only the
  // stale entries; filtering the grid does not discard a deliberate selection.
  useEffect(() => {
    const liveIds = new Set(clips.map(clip => clip.id))
    if (selectionAnchor.current && !liveIds.has(selectionAnchor.current)) selectionAnchor.current = null
    setSelectedIds(selected => {
      const next = new Set([...selected].filter(id => liveIds.has(id)))
      return next.size === selected.size ? selected : next
    })
  }, [clips])

  const updateSettings = useCallback(async (partial: Partial<Settings>) => {
    if (!window.flash) return
    const updated = await window.flash.setSettings(partial)
    setSettings(updated)
    if (partial.clipsFolder) refreshClips()
    // A rebind can fail if another program already owns the key.
    if (partial.hotkey !== undefined || partial.hotkeyShort !== undefined || partial.screenshotHotkey !== undefined) {
      const status = await window.flash.getHotkeyStatus()
      setHotkeysRegistered(status)
    }
    if (partial.voiceEnabled !== undefined || partial.voicePhrase !== undefined
      || partial.voiceRawFloor !== undefined || partial.voiceCooldownMs !== undefined) {
      setVoiceStatus(await window.flash.getVoiceStatus())
    }
  }, [refreshClips])

  // Confirmation lives here so the feed and the library get the same dialog
  // without either of them knowing it exists.
  const deleteClip = useCallback((clip: Clip) => {
    setConfirmRequest({
      title: 'Delete this clip?',
      body: `"${clip.title}" (${clip.game}, ${formatBytes(clip.size)}) will be permanently deleted from disk.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const result = await window.flash?.deleteClip(clip.filePath)
        // A failed delete used to be silent and the clip just stayed put.
        if (result?.error) setSaveState(state => ({ ...state, error: result.error! }))
        else if (!result?.deleted) setSaveState(state => ({ ...state, error: `Could not delete "${clip.title}". It may be open in another program.` }))
        refreshClips()
      },
    })
  }, [refreshClips])

  const deleteSelection = useCallback(() => {
    const selection = [...selectedClips]
    const count = selection.length
    if (!count) return
    const itemWord = count === 1 ? 'item' : 'items'
    const size = selection.reduce((total, clip) => total + clip.size, 0)
    setConfirmRequest({
      title: `Delete ${count} ${itemWord}?`,
      body: `${count} selected ${itemWord} (${formatBytes(size)}) will be permanently deleted from disk.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const results = await Promise.allSettled(selection.map(clip => window.flash?.deleteClip(clip.filePath)))
        const failed = results.filter(result => result.status === 'rejected' || !result.value?.deleted)
        if (failed.length) {
          const reason = failed
            .map(result => result.status === 'fulfilled' ? result.value?.error : undefined)
            .find((message): message is string => !!message)
          setSaveState(state => ({ ...state, error: reason || `Could not delete ${failed.length} of ${count} ${itemWord}.` }))
        }
        clearSelected()
        await refreshClips()
      },
    })
  }, [clearSelected, refreshClips, selectedClips])

  // Written to the clip's sidecar, so the answer survives a settings reset and
  // travels with the file. The list is updated optimistically because the round
  // trip is a small file write and a flicker on a star is worse than a stale one.
  const starClip = useCallback(async (clip: Clip) => {
    const next = !clip.starred
    setClips(current => current.map(c => c.filePath === clip.filePath ? { ...c, starred: next } : c))
    const result = await window.flash?.setClipStarred(clip.filePath, next)
    if (!result || result.error) {
      setClips(current => current.map(c => c.filePath === clip.filePath ? { ...c, starred: clip.starred } : c))
      setSaveState(state => ({ ...state, error: result?.error ?? 'Could not update the star' }))
    }
  }, [])

  const renameClip = useCallback(async (clip: Clip, name: string) => {
    if (!window.flash) return 'Rename is unavailable'
    const result = await window.flash.renameClip(clip.filePath, name)
    if (result.error) return result.error
    await refreshClips()
    return null
  }, [refreshClips])

  const toggleRecording = useCallback(async () => {
    if (!window.flash) return
    try {
      if (isRecording) await window.flash.capture.stopReplayBuffer()
      else if (!await window.flash.capture.startReplayBuffer()) {
        setSaveState(state => ({ ...state, error: 'Could not start the replay buffer' }))
      }
    } catch (error) {
      setSaveState(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Could not change the replay buffer',
      }))
    }
  }, [isRecording])

  // A freshly saved clip goes to the top of the feed, so the moment you just
  // kept is the one playing when you look over.
  const lastClipCount = useRef(0)
  useEffect(() => {
    if (clips.length > lastClipCount.current && lastClipCount.current > 0 && view === 'Feed' && sort === 'Recent' && !filtered) {
      const newest = shownClips[0]
      if (newest) setFeedPath(newest.filePath)
    }
    lastClipCount.current = clips.length
  }, [clips.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!window.flash) return

    const unsubscribe: (() => void)[] = []
    unsubscribe.push(window.flash.onRecordingState(setIsRecording))
    unsubscribe.push(window.flash.onNavigate((target: string) => setView(target === 'Settings' ? 'Settings' : target === 'Feed' ? 'Feed' : 'Library')))
    window.flash.getRecordingState().then(setIsRecording)
    window.flash.getSettings().then(setSettings)
    window.flash.getVoiceStatus().then(setVoiceStatus)
    window.flash.getHotkeyStatus().then(setHotkeysRegistered)
    window.flash.getAutostart().then(setAutostart)
    window.flash.capture?.listDisplays?.()?.then(setDisplays)
    unsubscribe.push(window.flash.capture.onSaveState(setSaveState))
    window.flash.getLearnedGames().then(setLearnedGames)
    window.flash.hasCaptureAddon().then(setCaptureAvailable)
    window.flash.capture?.getStatus?.()?.then(s => { setEncoder(s.encoder); if (s.captureBackend) setCaptureBackend(s.captureBackend) })
    unsubscribe.push(window.flash.onGameDetected(setDetectedGame))
    window.flash.getCurrentGame().then(setDetectedGame)
    unsubscribe.push(window.flash.onClipSavedRefresh(() => refreshClips()))
    unsubscribe.push(window.flash.onOpenSharedClip(link => {
      setSharedClip(link)
      setEditingClip(null)
      setView('Shared')
    }))
    window.flash.getUpdateState?.().then(setUpdate).catch(() => {})
    unsubscribe.push(window.flash.onUpdateState(setUpdate))

    // Served over flash-clip, not file://. A renderer page on
    // http://localhost:5173 cannot load file:// media, so in development the
    // sound silently never played - and the empty catch below hid it.
    // One preloaded element, rewound per save: a fresh Audio decoded on every
    // save started late and cut off when two saves landed close together.
    let clipSound: HTMLAudioElement | null = null
    unsubscribe.push(window.flash.onPlayClipSound((soundPath: string) => {
      if (!clipSound) { clipSound = new Audio(clipUrl(soundPath)); clipSound.preload = 'auto'; clipSound.volume = 0.6 }
      clipSound.currentTime = 0
      clipSound.play().catch(error => console.warn('Could not play the clip sound', error))
    }))

    refreshClips()
    return () => { unsubscribe.forEach(remove => remove()) }
  }, [refreshClips])


  return (
    <div className="relative" style={{ width: '100vw', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      <TitleBar
        isRecording={isRecording} onToggleRecording={toggleRecording}
        detectedGame={detectedGame} captureAvailable={captureAvailable}
        hotkey={settings.hotkey} hotkeyShort={settings.hotkeyShort} saveState={saveState} update={update}
        onFeedback={() => setFeedbackOpen(true)}
      />
      <Sidebar
        storage={storage}
        active={view === 'Library' ? page : view === 'Settings' ? 'Settings' : null}
        onNavigate={target => {
          setSharedClip(null)
          if (target === 'Settings') { setView('Settings'); return }
          setPage(target); setStarredOnly(target === 'Favorites'); setView('Library')
        }}
      />
      {/* Every screen renders inside this frame, right of the sidebar and under the title bar. */}
      <div className="absolute" style={{ top: TITLE_HEIGHT, left: SIDEBAR_WIDTH, right: 0, bottom: 0, background: 'var(--bg-content)' }}>

      {update.status === 'ready' && !updateDismissed && (
        <div role="status" className="absolute flex items-center gap-3"
          style={{ zIndex: 40, right: 20, bottom: 20, padding: '10px 14px', borderRadius: 14, background: 'var(--surface, #16161a)', border: '1px solid var(--edge-soft)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
          <span style={{ fontSize: 13 }}>Update ready{update.version ? ` (${update.version})` : ''}</span>
          <button className="btn btn-sm" onClick={() => window.flash?.installUpdate()}>Restart to update</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setUpdateDismissed(true)}>Later</button>
        </div>
      )}

      {/* The feed is unmounted while the editor is open, not just covered by
          it. Left mounted, its <video> keeps playing underneath and its key
          listener steals the arrow keys from the editor's own scrubbing. */}
      {view === 'Feed' && !editingClip && (
        <FeedView
          clips={shownClips}
          currentPath={feedPath}
          onPathChange={setFeedPath}
          filterLabel={filterLabel}
          filtered={filtered}
          onClearFilters={clearFilters}
          onOpenLibrary={() => setView('Library')}
          onDelete={deleteClip}
          onEdit={setEditingClip}
          onRename={renameClip}
          onStar={starClip}
          isRecording={isRecording} captureAvailable={captureAvailable}
          hotkey={settings.hotkey} bufferLength={settings.bufferLength}
          onToggleRecording={toggleRecording}
        />
      )}

      {/* Kept mounted while hidden so the scroll position survives a trip to
          the feed; hidden tiles fall out of view and release their decoders. */}
      {view === 'Library' && page === 'Games' && (
        <main className="absolute inset-0 overflow-y-auto">
          <PageTitle>Games</PageTitle>
          {games.length === 0
            ? <p style={{ padding: '12px 24px', fontSize: 13, color: 'var(--muted)' }}>Games appear here once you save a clip in one.</p>
            : <ul style={{ padding: '16px 24px' }}>{games.map(game => (
                <li key={game.name}>
                  <button className="flex items-center justify-between w-full" style={{ height: 40, padding: '0 12px', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
                    onClick={() => { setGameFilter(game.name); setPage('Library') }}>
                    {game.name}<span style={{ fontSize: 12, color: 'var(--muted)' }}>{game.count} {game.count === 1 ? 'clip' : 'clips'}</span>
                  </button>
                </li>))}
              </ul>}
        </main>
      )}
      {view === 'Library' && page === 'Trash' && (
        <main className="absolute inset-0">
          <PageTitle>Trash</PageTitle>
          {/* TODO: deleting is permanent today; a real Trash needs a soft-delete backend. */}
          <p style={{ padding: '12px 24px', fontSize: 13, color: 'var(--muted)' }}>Trash is empty. Deleted clips are removed right away.</p>
        </main>
      )}
      <main className="absolute inset-0 flex flex-col" style={{ display: view === 'Library' && page !== 'Games' && page !== 'Trash' ? 'flex' : 'none' }}>
        <LibraryView
          title={page}
          captureAvailable={captureAvailable}
          onRetry={toggleRecording}
          hotkey={settings.hotkey} bufferLength={settings.bufferLength}
          onSetupHotkeys={() => setView('Settings')}
          clips={shownClips}
          games={allGames} gameFilter={gameFilter} setGameFilter={setGameFilter}
          starredOnly={starredOnly} setStarredOnly={setStarredOnly}
          starredCount={clips.filter(c => c.starred).length}
          sort={sort} setSort={setSort}
          query={clipQuery} onQueryChange={setClipQuery}
          storage={storage} onOpenFolder={() => window.flash?.openClipsFolder()}
          shortcutsEnabled={view === 'Library' && editingClip === null}
          selectedIds={selectedIds}
          onToggleSelection={toggleSelected}
          onSelectRange={selectDisplayedRange}
          onSelectAll={selectAllDisplayed}
          onClearSelection={clearSelected}
          onOpenClip={clip => { setFeedPath(clip.filePath); setView('Feed') }}
          onDeleteClip={deleteClip}
          onStarClip={starClip}
          suspendThumbnails={editingClip !== null}
        />
        {selectedClips.length > 0 && (
          <SelectionBar
            items={selectedClips}
            games={games.map(game => game.name)}
            onClear={clearSelected}
            onDelete={deleteSelection}
            onRefresh={refreshClips}
          />
        )}
      </main>

      {view === 'Settings' && (
        <main className="absolute inset-0 flex flex-col">
          <SettingsView
            settings={settings} onChange={updateSettings} storage={storage} encoder={encoder}
            captureBackend={captureBackend}
            voiceStatus={voiceStatus}
            hotkeysRegistered={hotkeysRegistered} autostart={autostart} onToggleAutostart={toggleAutostart}
            displays={displays} health={health}
            learnedGames={learnedGames}
            onForgetGame={async exe => setLearnedGames(await window.flash!.forgetGame(exe))}
            onOpenFolder={() => window.flash?.openClipsFolder()}
            onPickFolder={async () => {
              const folder = await window.flash?.pickClipsFolder()
              if (folder) { setSettings(s => ({ ...s, clipsFolder: folder })); refreshClips() }
            }}
          />
        </main>
      )}

      {view === 'Shared' && sharedClip && <SharedClipView link={sharedClip} />}
      </div>

      {editingClip && (
        <Editor clip={editingClip} onClose={() => setEditingClip(null)} />
      )}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} onSent={() => {
        setFeedbackSent(true)
        setTimeout(() => setFeedbackSent(false), 4000)
      }} />}
      {feedbackSent && (
        <div role="status" className="fixed z-[110]"
          style={{
            right: 24, bottom: 24, padding: '12px 18px', borderRadius: 8, fontSize: 13, color: 'var(--fg)',
            background: 'var(--panel)', border: '1px solid var(--edge)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}>
          Feedback sent. Thank you!
        </div>
      )}
      {confirmRequest && (
        <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      )}
    </div>
  )
}
