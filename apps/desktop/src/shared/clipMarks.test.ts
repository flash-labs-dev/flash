import { strict as assert } from 'node:assert'
import { clipMarkOffsets, recordClipMark, transferClipMarks } from './clipMarks.ts'
import { parseSidecar, serialiseSidecar } from './clipFiles.ts'

const save = 100_000
assert.deepEqual(clipMarkOffsets([69_999, 70_000, 85_250, 100_000, 100_001], save, 30), [0, 15.25, 30])
assert.deepEqual(clipMarkOffsets([85_250, 95_000], save, 10), [5])
assert.deepEqual(clipMarkOffsets([85_250], save, 0), [])
assert.deepEqual(clipMarkOffsets([NaN, Infinity], save, 30), [])

const duration = 9.49
const marksSec = transferClipMarks([4.99, 5, 9, 13.9, 14.2, 14.49, 15], 5, duration)
assert.deepEqual(marksSec, [0, 4, 8.9, 9.2, 9.49])
assert.deepEqual(parseSidecar(serialiseSidecar({ duration, marksSec })),
  { duration: 9.49, marksSec: [0, 4, 8.9, 9.2, 9.49] })
assert.deepEqual(transferClipMarks([0, 1, 8.9, 9.1], 0, duration), [0, 1, 8.9, 9.1])
assert.deepEqual(transferClipMarks([0.8], 0.1, 0.7), [0.7])
assert.deepEqual(parseSidecar('{"duration":10,"game":"Arena","marksSec":[2,"bad",12,8],"starred":true}'),
  { duration: 10, game: 'Arena', marksSec: [2, 12, 8], starred: true })

let recorded = recordClipMark([], 10_000, 30)
assert.deepEqual(recorded, { marks: [10_000], recorded: true, lastPressMs: 10_000 })
for (const now of [10_100, 10_500, 10_900, 11_300]) {
  recorded = recordClipMark(recorded.marks, now, 30, recorded.lastPressMs)
  assert.deepEqual(recorded, { marks: [10_000], recorded: false, lastPressMs: now })
}
recorded = recordClipMark(recorded.marks, 11_801, 30, recorded.lastPressMs)
assert.deepEqual(recorded, { marks: [10_000, 11_801], recorded: true, lastPressMs: 11_801 })
assert.deepEqual(recordClipMark([10_000, 15_000], 20_000, 5, 15_000),
  { marks: [15_000, 20_000], recorded: true, lastPressMs: 20_000 })

console.log('clip mark offsets self-check passed')
