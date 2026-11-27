import { useEffect, useState } from 'react'

// The header shared by the clip player and the editor, so the two screens
// cannot drift apart. It takes a path rather than a clip: everything it does is
// per-file, and keeping it decoupled avoids a circular import between the two
// screens that both use it.
//
// `middle` is whatever belongs between Back and the actions - the clip counter
// in the player, the clip's name in the editor.
const UNSAVED_AUDIO = 'Your mute and volume changes are not in this file. Save, then share the saved copy.'

export function ClipActionBar({ filePath, onClose, onDelete, middle, backLabel = 'Back', unsavedAudio = false }: {
  filePath: string
  // The editor has audio changes this file does not carry: do not send it.
  unsavedAudio?: boolean
  onClose: () => void
  onDelete?: () => void
  middle?: React.ReactNode
  backLabel?: string
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [linkNote, setLinkNote] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)

  // Each note gets its own timer, so an older one cannot clear a newer note.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  useEffect(() => {
    if (!linkNote || linkBusy) return
    const timer = setTimeout(() => setLinkNote(null), 4000)
    return () => clearTimeout(timer)
  }, [linkNote, linkBusy])

  return (
    <div className="flex items-center justify-between gap-4 shrink-0 titlebar-drag" style={{ height: 56, padding: '0 20px', borderBottom: '1px solid var(--edge-soft)' }}>
      <div className="flex items-center gap-4 min-w-0 titlebar-no-drag">
        <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ paddingLeft: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 6l-6 6 6 6" />
          </svg>
          {backLabel}
        </button>
        {middle}
      </div>

      <div className="flex items-center gap-2 shrink-0 titlebar-no-drag">
        <button
          draggable
          onDragStart={e => {
            e.preventDefault()
            if (unsavedAudio) { setCopied('Save audio first'); return }
            window.flash?.startClipDrag(filePath)
          }}
          onClick={async () => {
            if (unsavedAudio) { setCopied('Save audio first'); return }
            setCopied(null)
            const ok = await window.flash?.copyClipFile(filePath)
            setCopied(ok ? 'Copied' : 'Copy failed')
          }}
          title={unsavedAudio ? UNSAVED_AUDIO : 'Click to copy the file, or drag this straight into Discord'}
          className="btn btn-sm" style={{ cursor: 'grab' }}>
          {copied ?? 'Copy / drag'}
        </button>
        {/\.mp4$/i.test(filePath) && (
          <button
            // aria-disabled, not disabled: a keyboard user keeps focus while it uploads.
            aria-disabled={linkBusy}
            onClick={async () => {
              if (linkBusy) return
              if (unsavedAudio) { setLinkNote('Save audio first'); return }
              setLinkBusy(true)
              setLinkNote('Uploading...')
              try {
                const result = await window.flash?.shareClipLink(filePath)
                setLinkNote(result?.ok ? `Link copied. Works for ${result.days} days` : (result?.error ?? 'Could not make a link'))
              } catch {
                setLinkNote('Could not make a link')
              } finally {
                setLinkBusy(false)
              }
            }}
            title={unsavedAudio ? UNSAVED_AUDIO : 'Uploads this clip and copies a link that works for 7 days'}
            className="btn btn-sm">
            {linkNote ?? 'Share'}
          </button>
        )}
        <button onClick={() => window.flash?.showClipInFolder(filePath)} className="btn btn-sm">
          Show in folder
        </button>
        {onDelete && (
          <button onClick={onDelete} className="btn btn-sm btn-danger">
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
