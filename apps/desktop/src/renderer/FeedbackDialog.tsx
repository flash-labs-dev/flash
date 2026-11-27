import { useEffect, useState } from 'react'
import { FEEDBACK_MAX_LENGTH, validateFeedback } from '../shared/feedback'
import { DialogFrame } from './ui'

export function FeedbackDialog({ onClose, onSent }: { onClose: () => void; onSent?: () => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooLong = text.length > FEEDBACK_MAX_LENGTH
  const canSend = !sending && !tooLong && validateFeedback(text) === null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      // Escape also cancels an input-method composition; that must not discard the draft.
      if (event.isComposing) return
      event.preventDefault()
      if (!sending) onClose()
    }
    // Capture phase: the feed also listens for Escape and would leave
    // underneath the dialog otherwise.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sending, onClose])

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    let result: { ok: boolean; error?: 'rate-limited' | 'failed' }
    try { result = await window.flash.sendFeedback(text) }
    catch { result = { ok: false, error: 'failed' } }
    setSending(false)
    if (result.ok) {
      onSent?.()
      onClose()
      return
    }
    setError(result.error === 'rate-limited'
      ? 'Too many messages, try again in an hour.'
      : 'Could not send. Check your connection and try again.')
  }

  return (
    // Not closable mid-send: the dialog would report success after it was dismissed.
    <DialogFrame label="Send feedback" width={460} onBackdrop={sending ? undefined : onClose}>
        <h2 className="display" style={{ fontSize: 30, color: 'var(--fg)', marginBottom: 16 }}>Send feedback</h2>
        <textarea autoFocus value={text} disabled={sending} aria-label="Feedback message"
          placeholder="What's broken, or what would make Flash better?"
          onChange={event => setText(event.target.value)}
          className="field w-full"
          style={{ height: 'auto', minHeight: 120, padding: 12, lineHeight: 1.5, resize: 'vertical' }} />
        <div className="flex justify-end" style={{ marginTop: 8 }}>
          <span className="tabular" style={{ fontSize: 12, color: tooLong ? 'var(--alert)' : 'var(--muted-2)' }}>
            {text.length} / {FEEDBACK_MAX_LENGTH}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5, marginTop: 4 }}>
          Sends your message plus the Flash version and your OS. Nothing else.
        </p>
        {error && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--alert)', lineHeight: 1.6, marginTop: 12 }}>{error}</p>
        )}
        <div className="flex justify-end gap-2" style={{ marginTop: 24 }}>
          <button type="button" onClick={onClose} disabled={sending} className="btn">Cancel</button>
          <button type="button" onClick={send} disabled={!canSend} className="btn btn-solid">
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
    </DialogFrame>
  )
}
