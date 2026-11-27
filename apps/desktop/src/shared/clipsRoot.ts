import { posix, win32 } from 'node:path'

export const caseKey = (value: string, platform = process.platform): string =>
  platform === 'win32' ? value.toLowerCase().replace(/ς/g, 'σ') : platform === 'darwin' ? value.toLowerCase() : value

export function samePath(left: string, right: string, platform = process.platform): boolean {
  const paths = platform === 'win32' ? win32 : posix
  return caseKey(paths.resolve(left), platform) === caseKey(paths.resolve(right), platform)
}

// Compare resolved segments, with case folding only on Windows and macOS.
export function isInsideRoot(root: string, candidate: string, platform = process.platform): boolean {
  if (typeof root !== 'string' || typeof candidate !== 'string' || !root || !candidate) return false
  const paths = platform === 'win32' ? win32 : posix
  if (!paths.isAbsolute(root) || !paths.isAbsolute(candidate)) return false
  let base = paths.resolve(root), target = paths.resolve(candidate)
  base = caseKey(base, platform)
  target = caseKey(target, platform)
  const relative = paths.relative(base, target)
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`))
}
