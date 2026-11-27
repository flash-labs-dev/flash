// A failed capture can be checked every five seconds, including after a slow retry.
// Keep one desktop alert per minute while the failure persists.
export function captureInterruptionNotice(
  wasRecording: boolean, message: string, lastNotifiedAt: number, now: number,
): string | undefined {
  return wasRecording && now - lastNotifiedAt >= 60_000 ? message : undefined
}
