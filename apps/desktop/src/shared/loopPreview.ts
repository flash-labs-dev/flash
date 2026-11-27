export function loopPreviewTarget(
  currentTime: number,
  range: { inSec: number; outSec: number },
  enabled: boolean,
  playing: boolean,
): number | null {
  return enabled && playing && range.outSec > range.inSec && currentTime >= range.outSec
    ? range.inSec : null
}
