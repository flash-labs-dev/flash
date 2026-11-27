import { strict as assert } from 'node:assert'
import { mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invalidateSidecarCache, pruneSidecarCache, readSidecarCached, writeSidecar } from './clipFiles.ts'
import { sidecarPath } from './clipPath.ts'

const folder = mkdtempSync(join(tmpdir(), 'flash-sidecar-cache-'))
const clip = join(folder, 'round.mp4')
const moved = join(folder, 'moved.mp4')
const original = join(folder, 'original.mp4')
try {
  writeFileSync(clip, '')
  writeSidecar(clip, { game: 'First' })
  utimesSync(sidecarPath(clip), new Date(1700000000000), new Date(1700000000000))
  const before = statSync(sidecarPath(clip))
  assert.equal(readSidecarCached(clip)?.game, 'First')

  // The app's atomic write must invalidate even when size and mtime match.
  writeSidecar(clip, { game: 'Later' })
  utimesSync(sidecarPath(clip), before.atime, before.mtime)
  assert.equal(statSync(sidecarPath(clip)).size, before.size)
  assert.equal(statSync(sidecarPath(clip)).mtimeMs, before.mtimeMs)
  assert.equal(readSidecarCached(clip)?.game, 'Later')

  // A rename or move may reuse a previously cached destination path.
  writeFileSync(moved, '')
  writeSidecar(moved, { game: 'Older' })
  utimesSync(sidecarPath(moved), before.atime, before.mtime)
  const destinationStat = statSync(sidecarPath(moved))
  assert.equal(readSidecarCached(moved)?.game, 'Older')
  rmSync(moved)
  rmSync(sidecarPath(moved))
  renameSync(clip, moved)
  renameSync(sidecarPath(clip), sidecarPath(moved))
  utimesSync(sidecarPath(moved), destinationStat.atime, destinationStat.mtime)
  assert.equal(statSync(sidecarPath(moved)).size, destinationStat.size)
  assert.equal(statSync(sidecarPath(moved)).mtimeMs, destinationStat.mtimeMs)
  invalidateSidecarCache(clip)
  invalidateSidecarCache(moved)
  assert.equal(readSidecarCached(moved)?.game, 'Later')

  renameSync(moved, original)
  renameSync(sidecarPath(moved), sidecarPath(original))
  invalidateSidecarCache(moved)
  invalidateSidecarCache(original)
  assert.equal(readSidecarCached(moved), null)
  assert.equal(readSidecarCached(original)?.game, 'Later')

  // A library scan after switching folders must release the old folder's metadata.
  assert.equal(pruneSidecarCache(new Set([moved])), 1)
  assert.equal(pruneSidecarCache(new Set([moved])), 0)
  assert.equal(readSidecarCached(original)?.game, 'Later')

  const deletedStat = statSync(sidecarPath(original))
  rmSync(original)
  rmSync(sidecarPath(original))
  writeFileSync(original, '')
  writeFileSync(sidecarPath(original), JSON.stringify({ game: 'After' }))
  utimesSync(sidecarPath(original), deletedStat.atime, deletedStat.mtime)
  assert.equal(statSync(sidecarPath(original)).size, deletedStat.size)
  assert.equal(statSync(sidecarPath(original)).mtimeMs, deletedStat.mtimeMs)
  invalidateSidecarCache(original)
  assert.equal(readSidecarCached(original)?.game, 'After')
  rmSync(sidecarPath(original))
  assert.equal(readSidecarCached(original), null)
} finally {
  rmSync(folder, { recursive: true, force: true })
}
console.log('sidecar cache invalidation self-check passed')
