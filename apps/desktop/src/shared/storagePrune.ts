export interface StorageClip {
  filePath: string
  size: number
  createdAt: number
  eligible: boolean
}

// The caller establishes ownership and protection from fresh filesystem data.
// This function only decides the order and how much space needs to be freed.
// A tight limit must never empty the library.
const KEEP_NEWEST = 3

// Account for space only after the filesystem confirms a deletion. A refused
// candidate must not prevent the next old clip from being tried.
export async function pruneStorageClips(
  clips: readonly StorageClip[], maxBytes: number,
  remove: (filePath: string) => Promise<boolean>,
  onLimitCannotBeMet?: () => void,
): Promise<number> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return 0
  let used = clips.reduce((sum, clip) => sum + (Number.isFinite(clip.size) && clip.size >= 0 ? clip.size : 0), 0)
  const candidates = clips.filter(clip => clip.eligible && clip.createdAt > 0 &&
    Number.isFinite(clip.createdAt) && Number.isFinite(clip.size) && clip.size >= 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.filePath.localeCompare(b.filePath))
  const removable = candidates.slice(0, -KEEP_NEWEST)
  if (used > maxBytes && used - removable.reduce((sum, clip) => sum + clip.size, 0) > maxBytes) {
    onLimitCannotBeMet?.()
    return 0
  }
  let removed = 0
  for (const clip of removable) {
    if (used <= maxBytes) break
    if (await remove(clip.filePath)) {
      used -= clip.size
      removed++
    }
  }
  return removed
}
