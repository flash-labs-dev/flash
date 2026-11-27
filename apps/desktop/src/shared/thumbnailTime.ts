export function thumbnailTime(marksSec: readonly number[], durationSec: number): { timeSec: number; fromMark: boolean } {
  const firstMark = Number.isFinite(durationSec) && durationSec >= 0
    ? marksSec.find(mark => Number.isFinite(mark) && mark >= 0 && mark <= durationSec)
    : undefined
  return firstMark === undefined
    ? { timeSec: Math.min(0.5, (durationSec || 1) / 2), fromMark: false }
    : { timeSec: firstMark, fromMark: true }
}
