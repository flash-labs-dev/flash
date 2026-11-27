import { strict as assert } from 'node:assert'
import { BatchReservations } from './batchReservations.ts'

const reservations = new BatchReservations()
assert.deepEqual(reservations.replace(1, 'A', ['first.mp4']), [])
assert.deepEqual(reservations.replace(1, 'B', ['second.mp4']), ['first.mp4'])
assert.deepEqual(reservations.release(1, 'A'), [])
assert.deepEqual(reservations.release(1, 'B'), ['second.mp4'])
assert.deepEqual(reservations.release(1, 'B'), [])
console.log('PASS: old batch cannot release new reservation')
