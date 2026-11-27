// Self-check for the share-copy size menu. Run with:
//   node --experimental-strip-types src/shared/exportLimits.test.ts
import { strict as assert } from 'node:assert'
import { EXPORT_LIMITS, DEFAULT_EXPORT_LIMIT, codecNote, exportSuffix, findExportLimit } from './exportLimits.ts'

// Every entry is reachable by its id, and ids are unique.
assert.equal(new Set(EXPORT_LIMITS.map(limit => limit.value)).size, EXPORT_LIMITS.length)
for (const limit of EXPORT_LIMITS) assert.equal(findExportLimit(limit.value), limit)

// An id from an older build, or junk, falls back to the first entry.
assert.equal(findExportLimit('nope'), EXPORT_LIMITS[0])
assert.equal(findExportLimit(String(10 * 1048576)), EXPORT_LIMITS[0])

// Current Discord attachment tiers: 20MB free, 50MB Basic, 1GB Nitro.
assert.equal(findExportLimit(DEFAULT_EXPORT_LIMIT).codec, 'auto')
assert.equal(findExportLimit(DEFAULT_EXPORT_LIMIT).bytes, 20 * 1048576)
assert.equal(EXPORT_LIMITS.find(limit => limit.hint === 'Discord free')?.bytes, 20 * 1048576)
assert.equal(EXPORT_LIMITS.find(limit => limit.hint === 'Nitro')?.bytes, 1024 * 1048576)

// The two 20MB copies of one clip get different names.
assert.equal(exportSuffix(20 * 1048576, 'auto'), ' - 20MB.mp4')
assert.equal(exportSuffix(20 * 1048576, 'h264'), ' - 20MB H264.mp4')
assert.equal(exportSuffix(1024 * 1048576, 'auto'), ' - 1GB.mp4')

// The note only speaks up when Auto did not get AV1.
assert.equal(codecNote('auto', 'av1'), '')
assert.equal(codecNote('auto', 'hevc'), 'Exported as HEVC (no AV1 encoder on this GPU)')
assert.equal(codecNote('auto', 'h264'), 'Exported as H.264 (no AV1 encoder on this GPU)')
assert.equal(codecNote('h264', 'h264'), '')
assert.equal(codecNote('auto', undefined), '')

console.log('exportLimits self-check passed')
