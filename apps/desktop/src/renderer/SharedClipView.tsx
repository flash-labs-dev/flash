import { useEffect, useMemo, useState } from 'react'
import { SHARE_ORIGIN } from '../shared/shareLink'

export interface SharedClipLink {
  id: string
  mp4Url: string
}

export function SharedClipView({ link }: { link: SharedClipLink }) {
  const safeUrl = useMemo(() => {
    const prefix = `${SHARE_ORIGIN}/c/`
    return link.mp4Url.startsWith(prefix) ? link.mp4Url : ''
  }, [link.mp4Url])
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')

  useEffect(() => setState('idle'), [safeUrl])

  const save = async () => {
    if (!safeUrl || state === 'saving' || state === 'saved') return
    setState('saving')
    try {
      const result = await window.flash.saveSharedClip(safeUrl)
      setState(result.path ? 'saved' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <main className="absolute inset-x-0 bottom-0 grain" style={{ top: 48, background: 'var(--bg)' }}>
      <div style={{ width: 'min(1120px, calc(100% - 96px))', height: '100%', margin: '0 auto', padding: '32px 0 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div className="caps" style={{ color: 'var(--muted)', marginBottom: 8 }}>Shared clip</div>
          <h1 className="display" style={{ color: 'var(--fg)', fontSize: 48, lineHeight: .92 }}>Shared clip</h1>
        </div>
        <div style={{ flex: 1, minHeight: 160, position: 'relative', display: 'grid', placeItems: 'center', background: '#000', border: '1px solid var(--edge-soft)' }}>
          {safeUrl
            ? <video key={safeUrl} src={safeUrl} controls autoPlay style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} aria-label="Shared clip" />
            : <p role="alert" style={{ color: 'var(--alert)', fontSize: 13 }}>This shared clip link is not valid.</p>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-solid" type="button" onClick={save} disabled={!safeUrl || state === 'saving' || state === 'saved'}>
            {state === 'saving' ? 'Saving...' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Save failed, try again' : 'Save to library'}
          </button>
        </div>
      </div>
    </main>
  )
}
