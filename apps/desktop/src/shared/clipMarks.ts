// Convert wall-clock marks to positions in the clip captured at saveTimeMs.
export function clipMarkOffsets(markTimesMs: readonly number[], saveTimeMs: number, durationSec: number): number[] {
  if (!Number.isFinite(saveTimeMs) || !Number.isFinite(durationSec) || durationSec <= 0) return []
  const startMs = saveTimeMs - durationSec * 1000
  return markTimesMs
    .filter(mark => Number.isFinite(mark) && mark >= startMs && mark <= saveTimeMs)
    .map(mark => Math.min(durationSec, Math.max(0, (mark - startMs) / 1000)))
}

export function transferClipMarks(marksSec: readonly number[], startSec: number, durationSec: number): number[] {
  if (![startSec, durationSec].every(Number.isFinite) || startSec < 0 || durationSec < 0) return []
  return marksSec
    .filter(mark => Number.isFinite(mark) && mark >= startSec &&
      mark - startSec <= durationSec + Number.EPSILON * Math.max(1, mark, startSec, durationSec))
    .map(mark => Math.min(durationSec, mark - startSec))
}

export function recordClipMark(marksMs: readonly number[], nowMs: number, bufferLengthSec: number, lastPressMs = -Infinity): { marks: number[]; recorded: boolean; lastPressMs: number } {
  if (!Number.isFinite(nowMs) || !Number.isFinite(bufferLengthSec) || bufferLengthSec <= 0) return { marks: [...marksMs], recorded: false, lastPressMs }
  const marks = marksMs.filter(mark => Number.isFinite(mark) && mark >= nowMs - bufferLengthSec * 1000 && mark <= nowMs)
  // Every repeat renews the quiet interval, including a rejected one.
  if (nowMs - lastPressMs <= 500) return { marks, recorded: false, lastPressMs: nowMs }
  return { marks: [...marks, nowMs], recorded: true, lastPressMs: nowMs }
}
