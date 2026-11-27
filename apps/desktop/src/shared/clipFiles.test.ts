import { strict as assert } from 'node:assert'
import { cachedShareMp4Url, reusableShareUrl, type CachedShare } from './clipFiles.ts'

const now = Date.parse('2026-11-26T12:00:00Z')
const source = { path: 'C:/Clips/round.mp4', size: 1234, mtimeMs: 4567, preparationKey: 'mix-v1' }
const cache: CachedShare = {
  url: 'https://flashclipping.fyi/c/AbC_-12345xY',
  expiresAt: new Date(now + 2 * 60 * 60_000).toISOString(),
  sourcePath: source.path, sourceSize: source.size, sourceMtimeMs: source.mtimeMs,
  preparationKey: source.preparationKey,
}

assert.equal(reusableShareUrl(cache, source, now), cache.url)
assert.equal(reusableShareUrl(cache, { ...source, path: 'c:/clips/ROUND.mp4' }, now, 'win32'), cache.url)
assert.equal(cachedShareMp4Url(cache.url), 'https://share.flashclipping.fyi/c/AbC_-12345xY.mp4')
assert.equal(reusableShareUrl(undefined, source, now), null)
assert.equal(reusableShareUrl(cache, { ...source, size: source.size + 1 }, now), null)
assert.equal(reusableShareUrl(cache, { ...source, mtimeMs: source.mtimeMs + 1 }, now), null)
assert.equal(reusableShareUrl(cache, { ...source, path: 'C:/Clips/renamed.mp4' }, now), null)
assert.equal(reusableShareUrl(cache, { ...source, preparationKey: 'mix-v2' }, now), null)
assert.equal(reusableShareUrl(cache, source, now + 60 * 60_000), null)
assert.equal(reusableShareUrl({ ...cache, expiresAt: 'invalid' }, source, now), null)
assert.equal(reusableShareUrl({ ...cache, url: 'https://elsewhere.example/c/AbC_-12345xY' }, source, now), null)

console.log('clipFiles share cache self-check passed')
