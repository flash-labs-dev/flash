import { caseKey } from './clipsRoot.ts'

const FORBIDDEN_FILENAME_CHARACTERS = /[\\/:*?"<>|\x00-\x1f]/
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i

export function validateClipName(name: string): string | null {
  if (!name.trim()) return 'Enter a name'
  if (/^\.+$/.test(name.trim())) return 'A name cannot contain only dots'
  if (FORBIDDEN_FILENAME_CHARACTERS.test(name)) return 'Names cannot contain \\ / : * ? " < > or |'
  if (RESERVED_DEVICE_NAME.test(name.trim())) return 'That name is reserved by Windows'
  if (/[. ]$/.test(name)) return 'Names cannot end with a dot or space'
  return null
}

export function resolveClipFilename(name: string, extension: string, existingFilenames: readonly string[], platform = process.platform): string {
  const existing = new Set(existingFilenames.map(filename => caseKey(filename, platform)))
  let counter = 1

  while (true) {
    const suffix = counter === 1 ? '' : ` (${counter})`
    const basename = `${name}${suffix}`
    if (!existing.has(caseKey(`${basename}${extension}`, platform)) &&
        !existing.has(caseKey(`${basename}${extension}.json`, platform)) &&
        !existing.has(caseKey(`${basename}.json`, platform))) {
      return `${basename}${extension}`
    }
    counter++
  }
}
