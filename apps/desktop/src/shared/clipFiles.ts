import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sidecarPath } from './clipPath.ts'
import { salvageClipTags } from './clipTags.ts'
import { resolveClipFilename } from './rename.ts'
import { SHARE_ORIGIN, SHARE_PAGE_ORIGIN } from './shareLink.ts'
import { caseKey, samePath } from './clipsRoot.ts'

export interface CachedShare {
  url: string
  expiresAt: string
  sourcePath: string
  sourceSize: number
  sourceMtimeMs: number
  preparationKey: string
}

export interface Sidecar {
  duration?: number
  trim?: { inSec: number; outSec: number }
  marksSec?: number[]
  game?: string
  starred?: boolean
  tags?: string[]
  cachedShare?: CachedShare
}

// A candidate still needs a successful HEAD request before its link can be reused.
export function reusableShareUrl(cache: CachedShare | undefined, source: {
  path: string; size: number; mtimeMs: number; preparationKey: string
}, nowMs: number, platform = process.platform): string | null {
  if (!cache || !Number.isFinite(nowMs) ||
      !samePath(cache.sourcePath, source.path, platform) || cache.sourceSize !== source.size ||
      cache.sourceMtimeMs !== source.mtimeMs || cache.preparationKey !== source.preparationKey ||
      !Number.isFinite(source.size) || !Number.isFinite(source.mtimeMs)) return null
  const expiry = Date.parse(cache.expiresAt)
  if (!Number.isFinite(expiry) || expiry - nowMs <= 60 * 60_000) return null
  return /^https:\/\/flashclipping\.fyi\/c\/[A-Za-z0-9_-]{12}$/.test(cache.url) &&
    cache.url.startsWith(`${SHARE_PAGE_ORIGIN}/c/`) ? cache.url : null
}

export function cachedShareMp4Url(url: string): string {
  return `${SHARE_ORIGIN}${url.slice(SHARE_PAGE_ORIGIN.length)}.mp4`
}

export function writeSidecar(filePath: string, metadata: Sidecar): void {
  invalidateSidecarCache(filePath)
  writeAtomic(sidecarPath(filePath), serialiseSidecar(metadata))
}

export function serialiseSidecar(metadata: Sidecar): string {
  return JSON.stringify(metadata)
}

function writeAtomic(path: string, contents: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, contents, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function parseSidecar(contents: string): Sidecar {
  const value = JSON.parse(contents)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value.starred !== undefined && typeof value.starred !== 'boolean') ||
      (value.tags !== undefined && !Array.isArray(value.tags)) ||
      (value.game !== undefined && typeof value.game !== 'string') ||
      (value.duration !== undefined && (typeof value.duration !== 'number' ||
        !Number.isFinite(value.duration) || value.duration < 0)) ||
      (value.marksSec !== undefined && !Array.isArray(value.marksSec)) ||
      (value.cachedShare !== undefined && (!value.cachedShare || typeof value.cachedShare !== 'object' ||
        Array.isArray(value.cachedShare) || typeof value.cachedShare.url !== 'string' ||
        typeof value.cachedShare.expiresAt !== 'string' ||
        typeof value.cachedShare.sourcePath !== 'string' ||
        typeof value.cachedShare.sourceSize !== 'number' ||
        typeof value.cachedShare.sourceMtimeMs !== 'number' ||
        typeof value.cachedShare.preparationKey !== 'string'))) {
    throw new Error('Invalid clip metadata')
  }
  if (value.tags) value.tags = salvageClipTags(value.tags)
  if (value.marksSec) value.marksSec = value.marksSec.filter((mark: unknown) =>
    typeof mark === 'number' && Number.isFinite(mark) && mark >= 0)
  return value
}

// The library scan can reuse parsed metadata while its on-disk identity is unchanged.
const sidecarCache = new Map<string, { size: number; mtimeMs: number; value: Sidecar }>()

export function invalidateSidecarCache(filePath: string): void {
  sidecarCache.delete(filePath)
}

export function pruneSidecarCache(livePaths: ReadonlySet<string>): number {
  let removed = 0
  for (const filePath of sidecarCache.keys()) {
    if (!livePaths.has(filePath)) {
      sidecarCache.delete(filePath)
      removed++
    }
  }
  return removed
}

export function readSidecarCached(filePath: string): (Sidecar & { unreadable?: boolean }) | null {
  const path = sidecarPath(filePath)
  try {
    const { size, mtimeMs } = statSync(path)
    const cached = sidecarCache.get(filePath)
    if (cached?.size === size && cached.mtimeMs === mtimeMs) return cached.value
    sidecarCache.delete(filePath)
    const value = parseSidecar(readFileSync(path, 'utf8'))
    sidecarCache.set(filePath, { size, mtimeMs, value })
    return value
  } catch (error: any) {
    sidecarCache.delete(filePath)
    if (error?.code === 'ENOENT') return null
    console.warn(`Protecting clip with unreadable sidecar: ${filePath}`, error)
    return { starred: true, unreadable: true }
  }
}

export function readSidecar(filePath: string): (Sidecar & { unreadable?: boolean }) | null {
  try {
    return parseSidecar(readFileSync(sidecarPath(filePath), 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    // Losing metadata must never turn a previously protected clip into a prune candidate.
    console.warn(`Protecting clip with unreadable sidecar: ${filePath}`, error)
    return { starred: true, unreadable: true }
  }
}

export function migrateSidecars(folder: string): Set<string> {
  const protectedPaths = new Set<string>()
  const groups = new Map<string, string[]>()
  const mediaPaths = new Set<string>()
  for (const name of readdirSync(folder)) {
    const extension = extname(name).toLowerCase()
    if (!['.mp4', '.png'].includes(extension) || !statSync(join(folder, name)).isFile()) continue
    if (name.includes('.partial.')) continue
    mediaPaths.add(caseKey(join(folder, name)))
    const stem = caseKey(basename(name, extname(name)))
    groups.set(stem, [...(groups.get(stem) ?? []), join(folder, name)])
  }
  for (const files of groups.values()) {
    const legacy = files[0].slice(0, -extname(files[0]).length) + '.json'
    // A name such as round.mp4.png must not consume round.mp4's new sidecar.
    if (mediaPaths.has(caseKey(legacy.slice(0, -'.json'.length)))) continue
    try {
      const contents = readFileSync(legacy, 'utf8')
      if (files.length === 1 && !existsSync(sidecarPath(files[0]))) {
        invalidateSidecarCache(files[0])
        renameSync(legacy, sidecarPath(files[0]))
      } else {
        for (const file of files) {
          if (!existsSync(sidecarPath(file))) {
            invalidateSidecarCache(file)
            writeAtomic(sidecarPath(file), contents)
            continue
          }
          const metadata = parseSidecar(readFileSync(legacy, 'utf8'))
          const existing = readSidecar(file)
          if (existing?.unreadable) throw new Error(`Unreadable destination sidecar: ${file}`)
          writeSidecar(file, { ...metadata, ...existing, starred: metadata.starred === true || existing?.starred === true })
        }
        // Keep the legacy file until every copy succeeded, so interrupted migrations can retry.
        unlinkSync(legacy)
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT' && !existsSync(legacy)) continue
      console.warn(`Protecting clips whose sidecar migration failed: ${legacy}`, error)
      for (const file of files) protectedPaths.add(file)
    }
  }
  return protectedPaths
}

const reservedOutputs = new Set<string>()

export function reserveOutput(requested: string): { path: string; release: () => void } {
  const folder = dirname(requested)
  const extension = extname(requested)
  const taken = [...readdirSync(folder), ...Array.from(reservedOutputs)
    .filter(path => samePath(dirname(path), folder)).map(path => basename(path))]
  const path = join(folder, resolveClipFilename(basename(requested, extension), extension, taken))
  reservedOutputs.add(path)
  return { path, release: () => { reservedOutputs.delete(path) } }
}
