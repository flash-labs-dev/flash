// Translate only filesystem failures with a known cause. Native writers can
// also report generic failures that do not identify the underlying problem.
export function saveError(error: unknown, fallback = 'Failed to save'): string {
  const value = error as { code?: unknown; message?: unknown } | null
  const message = typeof error === 'string' ? error
    : typeof value?.message === 'string' ? value.message : fallback
  const code = typeof value?.code === 'string' ? value.code : ''
  const matches = (codes: readonly string[], phrase: RegExp) =>
    codes.includes(code) || codes.some(candidate => new RegExp(`\\b${candidate}\\b`, 'i').test(message)) || phrase.test(message)

  // Media Foundation reports HRESULT 0x80070000 plus the Win32 code; the file writer reports Win32 directly.
  const win32 = /Win32 (\d+)/.exec(message)?.[1]
  const windowsCode = win32 ? Number(win32) : Number(/HRESULT (\d+)/.exec(message)?.[1] ?? NaN) - 0x80070000
  const windows = (...errors: number[]) => errors.includes(windowsCode)

  if (windows(39, 112) || matches(['ENOSPC', 'EDQUOT'], /no space left on device|disk quota exceeded/i)) {
    return 'The clips drive is full. Free up space and try again.'
  }
  if (windows(2, 3, 21, 53, 64, 67, 1231) || matches(['ENOENT', 'ENODEV'], /no such file or directory|no such device/i)) {
    return 'The clips folder or drive is unavailable. Check that the drive is connected and choose a valid clips folder.'
  }
  if (windows(5, 19) || matches(['EACCES', 'EPERM', 'EROFS'], /permission denied|operation not permitted|read-only file system/i)) {
    return 'Flash cannot write to the clips folder. Check the folder permissions or choose another folder.'
  }
  if (windows(32, 33) || matches(['EBUSY'], /device or resource busy/i)) {
    return 'The save file is in use by another program. Close it there and try again.'
  }
  if (windows(206) || matches(['ENAMETOOLONG'], /file name too long/i)) {
    return 'The clips folder path is too long. Choose a shorter clips folder.'
  }
  if (windows(1117) || matches(['EIO'], /input\/output error/i)) {
    return 'The clips drive reported an I/O error. Check the drive and try again.'
  }
  return message
}
