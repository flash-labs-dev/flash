// Find the closest usable mark in screen pixels, before the pointer is clamped
// to the filmstrip. This keeps a pointer far outside the strip from snapping.
export function nearestTrimMark(
  pointerX: number, trackLeft: number, trackWidth: number, durationSec: number,
  marksSec: number[], minSec: number, maxSec: number,
): number | null {
  if (![pointerX, trackLeft, trackWidth, durationSec, minSec, maxSec].every(Number.isFinite) ||
      trackWidth <= 0 || durationSec <= 0 || minSec > maxSec) return null

  let nearest: number | null = null
  let distance = Infinity
  for (const mark of marksSec) {
    if (!Number.isFinite(mark) || mark < 0 || mark > durationSec || mark < minSec || mark > maxSec) continue
    const pixels = Math.abs(pointerX - (trackLeft + mark / durationSec * trackWidth))
    if (pixels <= 6 && pixels < distance) {
      nearest = mark
      distance = pixels
    }
  }
  return nearest
}
