import { strict as assert } from 'node:assert'
import { loopPreviewTarget } from './loopPreview.ts'

const range = { inSec: 2, outSec: 5 }
assert.equal(loopPreviewTarget(4.99, range, true, true), null)
assert.equal(loopPreviewTarget(5, range, true, true), 2)
assert.equal(loopPreviewTarget(5.1, range, true, true), 2)
assert.equal(loopPreviewTarget(10, { inSec: 2, outSec: 10 }, true, true), 2)
assert.equal(loopPreviewTarget(5, range, false, true), null)
assert.equal(loopPreviewTarget(5, range, true, false), null)
assert.equal(loopPreviewTarget(5, { inSec: 5, outSec: 5 }, true, true), null)

console.log('PASS: loop preview boundary and paused playback')
