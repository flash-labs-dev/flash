import { strict as assert } from 'node:assert'
import { estimatedCopyBytes, validTrimRange } from './editor.ts'
import { parseSidecar, serialiseSidecar } from './clipFiles.ts'

const trim = { inSec: 2, outSec: 5 }
assert.deepEqual(validTrimRange(trim, 10), trim)
assert.deepEqual(validTrimRange({ inSec: 2, outSec: 10.2 }, 10), { inSec: 2, outSec: 10 })
for (const invalid of [null, 'bad', { inSec: -1, outSec: 5 }, { inSec: 5, outSec: 2 },
  { inSec: 0, outSec: 11 }, { inSec: NaN, outSec: 5 }, { inSec: 0, outSec: Infinity }]) {
  assert.equal(validTrimRange(invalid, 10), null)
}
assert.equal(estimatedCopyBytes(1000, 10, trim), 300)
assert.equal(estimatedCopyBytes(1000, 0, trim), null)
assert.equal(estimatedCopyBytes(NaN, 10, trim), null)
assert.equal(estimatedCopyBytes(1000, 10, { inSec: 2, outSec: 12 }), null)

const sidecar = parseSidecar('{"duration":10,"game":"Arena","starred":true,"trim":{"inSec":"bad","outSec":11}}')
assert.equal(validTrimRange(sidecar.trim, sidecar.duration!), null)
const updated = parseSidecar(serialiseSidecar({ ...sidecar, trim }))
assert.deepEqual(updated, { duration: 10, game: 'Arena', starred: true, trim })

console.log('PASS: trim restoration, sidecar tolerance, and copy size estimate')
