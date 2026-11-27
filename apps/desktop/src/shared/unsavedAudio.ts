// Copy, drag and Share all send the file on disk. Mutes and volume set in the
// editor reach only the copy that Save writes, so a muted mic would still go out.
export function audioEditsPending(trackIds: string[], gains: Record<string, number>): boolean {
  return trackIds.some(id => (gains[id] ?? 1) !== 1)
}
