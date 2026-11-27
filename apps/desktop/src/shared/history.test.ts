// Run with: node --experimental-strip-types src/shared/history.test.ts
import { strict as assert } from 'node:assert'
import { createHistory, push, undo, redo } from './history.ts'
import type { History } from './history.ts'

const initial = createHistory(0)
assert.deepEqual(initial, { past: [], present: 0, future: [] })
assert.equal(undo(initial), initial)
assert.equal(redo(initial), initial)

const two = push(push(initial, 1), 2)
assert.deepEqual(undo(two), { past: [0], present: 1, future: [2] })
assert.deepEqual(redo(undo(two)), two)
assert.deepEqual(push(undo(two), 3), { past: [0, 1], present: 3, future: [] })

const many = Array.from({ length: 105 }, (_, index) => index + 1)
  .reduce<History<number>>((history, value) => push(history, value), initial)
assert.equal(many.past.length, 100)
assert.equal(many.past[0], 5)
assert.equal(many.past[99], 104)
assert.equal(undo(many).present, 104)
