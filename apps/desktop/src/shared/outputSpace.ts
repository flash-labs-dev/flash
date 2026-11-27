export function outputSpaceError(freeBytes: number, expectedBytes: number): string | null {
  // Leave room for the filesystem and the temporary file used by the native writer.
  const needed = expectedBytes + 64 * 1024 * 1024
  return freeBytes < needed
    ? 'Not enough free space on the clips drive to save this copy. Free up space and try again.'
    : null
}
