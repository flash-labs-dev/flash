import { strict as assert } from 'node:assert'
import { nearestTrimMark } from './trimMarkSnap.ts'

const snap = (pointerX: number, marks = [2, 5, 8], min = 0, max = 10) =>
  nearestTrimMark(pointerX, 100, 200, 10, marks, min, max)

assert.equal(snap(206), 5) // exactly six screen pixels
assert.equal(snap(206.1), null)
assert.equal(snap(201, [5, 5.2]), 5)
assert.equal(snap(200, [5], 5.1), null) // outside the valid trim range
assert.equal(snap(200, [5], 0, 4.9), null)
assert.equal(snap(100, [0]), 0)
assert.equal(snap(300, [10]), 10)
assert.equal(snap(-10, [0]), null) // pointer outside the strip
assert.equal(snap(200, [NaN, -1, 11, 5]), 5)
assert.equal(nearestTrimMark(200, 100, 0, 10, [5], 0, 10), null)

console.log('PASS: trim mark snapping uses screen pixels and valid trim bounds')
