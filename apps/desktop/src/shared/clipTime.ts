export type ClipTimeRange = 'any' | 'today' | '7days' | '30days'

export function rangeCutoff(range: ClipTimeRange, now: number): number | null {
  if (range === 'any') return null
  if (range === 'today') {
    const date = new Date(now)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  return now - (range === '7days' ? 7 : 30) * 24 * 60 * 60 * 1000
}
