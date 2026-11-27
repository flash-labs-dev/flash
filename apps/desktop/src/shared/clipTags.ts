export const MAX_CLIP_TAGS = 8
export const MAX_TAG_LENGTH = 24

// Null means invalid input; an empty or repeated label is simply omitted.
export function normalizeClipTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const tag = item.trim().replace(/\s+/g, ' ')
    if (tag.length > MAX_TAG_LENGTH) return null
    // A label made only of control or zero-width characters would show as an empty chip.
    if (!tag.replace(/[\p{Cc}\p{Cf}\s]/gu, '')) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    if (tags.length === MAX_CLIP_TAGS) return null
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

// For tags read from disk: one bad entry must not make the whole sidecar unreadable.
export function salvageClipTags(value: unknown[]): string[] {
  return value.reduce<string[]>((tags, item) => normalizeClipTags([...tags, item]) ?? tags, [])
}

export function changeClipTag(existing: unknown, input: unknown, action: unknown): string[] | null {
  const current = normalizeClipTags(existing)
  const single = normalizeClipTags([input])
  if (!current || !single || single.length !== 1 || (action !== 'add' && action !== 'remove')) return null
  const key = single[0].toLowerCase()
  return action === 'remove'
    ? current.filter(tag => tag.toLowerCase() !== key)
    : normalizeClipTags([...current, single[0]])
}
