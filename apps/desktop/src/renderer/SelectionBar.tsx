import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Dropdown } from './Dropdown'
import { DEFAULT_EXPORT_LIMIT, EXPORT_LIMITS, codecNote, findExportLimit } from '../shared/exportLimits'
import { shareSelection, shareWhenAvailable } from '../shared/shareSelection'
import { changeClipTag } from '../shared/clipTags'

export interface SelectionItem {
  id: string
  filePath: string
  game: string
  kind?: 'clip' | 'shot'
}

export function SelectionBar({ items, games, tags, onTagsChanged, onClear, onDelete, onRefresh, onConfirmShare }: {
  items: readonly SelectionItem[]
  games: readonly string[]
  tags: readonly string[]
  onTagsChanged: (updated: Map<string, string[]>) => void
  onClear: () => void
  onDelete: () => void
  onRefresh: () => Promise<void>
  onConfirmShare: (count: number, onConfirm: () => void) => void
}) {
  const [exportLimit, setExportLimit] = useState(DEFAULT_EXPORT_LIMIT)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const sharing = useRef(false)
  const stopSharing = useRef(false)
  const [shareStopping, setShareStopping] = useState(false)
  const [targetGame, setTargetGame] = useState(games[0] ?? '')
  const [note, setNote] = useState<string | null>(null)
  const busy = exportBusy || moveBusy || shareBusy || tagBusy

  useEffect(() => {
    if (!games.includes(targetGame)) setTargetGame(games[0] ?? '')
  }, [games, targetGame])

  // The bar unmounts when the selection clears; a batch share must not keep uploading with no Stop button.
  useEffect(() => () => { stopSharing.current = true }, [])

  // Capture phase, and stopped here: otherwise the library's Escape clears the selection instead.
  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>, open: boolean, close: (open: boolean) => void) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    close(false)
    event.currentTarget.querySelector('button')?.focus()
  }

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    window.flash?.startClipDrag(items.map(item => item.filePath))
  }

  const exportSelected = async () => {
    const exportable = items.filter(clip => clip.kind !== 'shot')
    const skipped = items.length - exportable.length
    let exported = 0
    let failed = 0
    const limit = findExportLimit(exportLimit)
    let fallback = ''
    setExportBusy(true)
    setExportOpen(false)
    setNote(`Exporting 0/${items.length}`)

    for (const clip of exportable) {
      try {
        const result = await window.flash?.exportClip(clip.filePath, limit.bytes, limit.codec)
        if (!result || result.error) failed++
        else { exported++; fallback = codecNote(limit.codec, result.codec) || fallback }
      } catch {
        failed++
      }
      setNote(`Exporting ${exported + failed}/${items.length}`)
    }

    const skippedNote = skipped ? ` — ${skipped} screenshot${skipped === 1 ? '' : 's'} skipped` : ''
    const failedNote = failed ? ` — ${failed} failed` : ''
    const codecSuffix = fallback ? ` — ${fallback}` : ''
    setNote(`Exported ${exported} of ${items.length}${skippedNote}${failedNote}${codecSuffix}`)
    setExportBusy(false)
  }

  const moveSelected = async () => {
    if (!targetGame || !window.flash) return
    setMoveBusy(true)
    setNote(`Moving 0/${items.length}`)
    try {
      const result = await window.flash.moveClips(items.map(item => item.filePath), targetGame)
      await onRefresh()
      setMoveOpen(false)
      if (result.error) setNote(`Moved ${result.moved} of ${items.length} — ${result.error}`)
      else onClear()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Move failed')
    } finally {
      setMoveBusy(false)
    }
  }

  const changeTags = async (action: 'add' | 'remove') => {
    if (!window.flash || busy) return
    if (changeClipTag([], tagInput, action) === null) {
      setNote('Use one tag of up to 24 characters')
      return
    }
    setTagBusy(true)
    setNote(`Updating tags for ${items.length} selected`)
    try {
      const result = await window.flash.changeClipTagsBatch(items.map(item => item.filePath), tagInput, action)
      onTagsChanged(new Map(result.updated.map(item => [item.filePath, item.tags])))
      setNote(`${action === 'add' ? 'Added' : 'Removed'} tag on ${result.updated.length} of ${items.length} · ${result.failed} failed`)
      if (!result.error) { setTagInput(''); setTagOpen(false) }
    } catch {
      setNote(`Tag update failed for ${items.length} clips`)
    } finally {
      setTagBusy(false)
    }
  }

  const startSharing = () => {
    if (sharing.current || busy || !window.flash) return
    const paths = items.filter(item => item.kind !== 'shot' && /\.mp4$/i.test(item.filePath))
      .map(item => item.filePath)
    if (!paths.length) return

    // Reset here, not in share(): an unmount while the confirm dialog is open must still cancel it.
    stopSharing.current = false

    const share = async () => {
      if (sharing.current || stopSharing.current) return
      sharing.current = true
      setShareStopping(false)
      setShareBusy(true)
      setExportOpen(false)
      setMoveOpen(false)
      setNote(`Sharing 0 of ${paths.length}`)
      let reservationToken: string | null = null
      try {
        reservationToken = await window.flash!.setBatchShareClips(paths)
        const result = await shareSelection(paths, path => shareWhenAvailable(path, next => window.flash!.shareClipLink(next), undefined, () => stopSharing.current), progress => {
          setNote(`Sharing ${progress.completed} of ${progress.total}`)
        }, () => stopSharing.current)
        let copied = false
        if (result.urls.length) {
          try {
            await navigator.clipboard.writeText(result.urls.join('\n'))
            copied = true
          } catch { /* Report the clipboard failure in the final status. */ }
        }
        const linkCount = result.urls.length
        const summary = linkCount
          ? `${linkCount} link${linkCount === 1 ? '' : 's'} made${copied ? ' and copied' : '; could not copy links'}`
          : 'No links made'
        const failures = result.failed ? ` · ${result.failed} failed` : ''
        setNote(stopSharing.current && result.completed < result.total
          ? `Stopped after ${result.completed} of ${result.total} · ${summary}${failures}`
          : result.stoppedBy
          ? `${result.stoppedBy} · ${summary}${failures}`
          : `${summary}${failures}`)
      } catch (error) {
        setNote(error instanceof Error ? `Sharing failed: ${error.message}` : 'Sharing failed')
      } finally {
        if (reservationToken) {
          try { await window.flash!.setBatchShareClips(null, reservationToken) } catch { /* A reloaded renderer releases its reservation in main. */ }
        }
        sharing.current = false
        setShareBusy(false)
        setShareStopping(false)
      }
    }

    if (paths.length > 1) onConfirmShare(paths.length, () => { void share() })
    else void share()
  }

  return (
    <div
      // Off while the tag box is open, or selecting its text starts a file drag.
      draggable={!busy && !tagOpen}
      onDragStart={startDrag}
      title="Drag the selected files into Discord"
      className="absolute flex flex-wrap items-center justify-center gap-2"
      style={{
        left: 16, right: 16, bottom: 20, zIndex: 40, width: 'max-content', maxWidth: 'calc(100% - 32px)',
        margin: '0 auto', padding: '10px 12px 10px 18px', cursor: busy ? 'default' : 'grab', borderRadius: 10,
        color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--edge)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)', animation: 'dialog-in 0.16s var(--ease-out)',
      }}>
      <span className="display" style={{ fontSize: 22, whiteSpace: 'nowrap', marginRight: 6 }}>
        {items.length} selected
      </span>
      <button type="button" onClick={onClear} disabled={busy} className="btn btn-sm btn-ghost">
        Clear
      </button>
      <div style={{ width: 1, height: 22, background: 'var(--edge)' }} />
      <button type="button" onClick={onDelete} disabled={busy} className="btn btn-sm btn-danger">
        Delete
      </button>
      <span className="flex items-center gap-1.5 px-2" style={{ fontSize: 12, color: 'var(--muted)' }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 4h8M2 8h8M4 2v8M8 2v8" stroke="currentColor" strokeWidth="1" opacity="0.65"/>
        </svg>
        Drag to Discord
      </span>
      <button type="button" onClick={startSharing} disabled={busy || !items.some(item => item.kind !== 'shot' && /\.mp4$/i.test(item.filePath))}
        className="btn btn-sm" title="Upload selected clips and copy public links">
        {shareBusy ? 'Sharing…' : 'Share'}
      </button>
      {shareBusy && <button type="button" className="btn btn-sm btn-danger" disabled={shareStopping}
        onClick={() => { stopSharing.current = true; setShareStopping(true) }}>
        {shareStopping ? 'Stopping after this clip…' : 'Stop'}
      </button>}
      <div className="relative" onKeyDownCapture={event => closeOnEscape(event, exportOpen, setExportOpen)}>
        <button type="button" onClick={() => { setMoveOpen(false); setTagOpen(false); setExportOpen(open => !open) }} disabled={busy}
          className="btn btn-sm" aria-expanded={exportOpen}>
          {exportBusy ? 'Exporting…' : 'Export to size'}
        </button>
        {exportOpen && (
          <div className="absolute flex items-center gap-2"
            style={{
              right: 0, bottom: 'calc(100% + 12px)', padding: 8, borderRadius: 8,
              background: 'var(--panel)', border: '1px solid var(--edge)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            }}>
            <Dropdown label="Upload limit"
              value={exportLimit}
              onChange={setExportLimit}
              title="Upload limit to fit under"
              options={EXPORT_LIMITS}
              width={150}
            />
            <button type="button" onClick={exportSelected} className="btn btn-sm btn-solid">
              Export
            </button>
          </div>
        )}
      </div>
      <div className="relative" onKeyDownCapture={event => closeOnEscape(event, moveOpen, setMoveOpen)}>
        <button type="button" onClick={() => { setExportOpen(false); setTagOpen(false); setMoveOpen(open => !open) }} disabled={busy || games.length === 0}
          className="btn btn-sm" aria-expanded={moveOpen}>
          {moveBusy ? 'Moving…' : 'Move to game'}
        </button>
        {moveOpen && targetGame && (
          <div className="absolute flex items-center gap-2"
            style={{
              right: 0, bottom: 'calc(100% + 12px)', padding: 8, borderRadius: 8,
              background: 'var(--panel)', border: '1px solid var(--edge)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            }}>
            <Dropdown label="Target game"
              value={targetGame}
              onChange={setTargetGame}
              title="Target game"
              options={games.map(game => ({ value: game, label: game }))}
              width={180}
            />
            <button type="button" onClick={moveSelected} className="btn btn-sm btn-solid">
              Move
            </button>
          </div>
        )}
      </div>
      <div className="relative" onKeyDownCapture={event => closeOnEscape(event, tagOpen, setTagOpen)}>
        <button type="button" onClick={() => { setExportOpen(false); setMoveOpen(false); setTagOpen(open => !open) }} disabled={busy}
          className="btn btn-sm" aria-expanded={tagOpen}>
          {tagBusy ? 'Tagging…' : 'Tags'}
        </button>
        {tagOpen && (
          <div className="absolute flex items-center gap-2" style={{
            right: 0, bottom: 'calc(100% + 12px)', padding: 8, borderRadius: 8,
            background: 'var(--panel)', border: '1px solid var(--edge)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          }}>
            <input className="field" aria-label="Tag for selected clips" list="selection-tags" placeholder="Tag" value={tagInput} readOnly={tagBusy}
              onChange={event => setTagInput(event.target.value)} style={{ width: 140, height: 32 }}
              onKeyDown={event => { if (event.key === 'Enter' && tagInput.trim()) void changeTags('add') }} />
            <datalist id="selection-tags">{tags.map(tag => <option key={tag} value={tag} />)}</datalist>
            <button type="button" className="btn btn-sm btn-solid" disabled={tagBusy || !tagInput.trim()}
              onClick={() => void changeTags('add')}>Add</button>
            <button type="button" className="btn btn-sm" disabled={tagBusy || !tagInput.trim()}
              onClick={() => void changeTags('remove')}>Remove</button>
          </div>
        )}
      </div>
      {note && (
        <span role="status" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', flexBasis: '100%' }}>
          {note}
        </span>
      )}
    </div>
  )
}
