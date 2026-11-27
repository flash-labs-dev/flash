import { strict as assert } from 'node:assert'
import { thumbnailTime } from './thumbnailTime.ts'

assert.deepEqual(thumbnailTime([], 10), { timeSec: 0.5, fromMark: false })
assert.deepEqual(thumbnailTime([], 0.6), { timeSec: 0.3, fromMark: false })
assert.deepEqual(thumbnailTime([NaN, -1, Infinity, 11, 4, 2], 10), { timeSec: 4, fromMark: true })
assert.deepEqual(thumbnailTime([10, 2], 10), { timeSec: 10, fromMark: true })
assert.deepEqual(thumbnailTime([0], 10), { timeSec: 0, fromMark: true })
assert.deepEqual(thumbnailTime([11, -1], 10), { timeSec: 0.5, fromMark: false })
assert.deepEqual(thumbnailTime([2], NaN), { timeSec: 0.5, fromMark: false })
