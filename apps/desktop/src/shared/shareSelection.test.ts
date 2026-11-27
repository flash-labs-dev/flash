// Run with: node --experimental-strip-types src/shared/shareSelection.test.ts
import { strict as assert } from 'node:assert'
import { shareSelection, shareWhenAvailable, type ShareResult } from './shareSelection.ts'

const success = (url: string): ShareResult => ({ ok: true, url, days: 7 })
let busyAttempts = 0
let waits = 0
assert.deepEqual(await shareWhenAvailable('b', async () =>
  ++busyAttempts < 3 ? { ok: false, error: 'A link is already being made' } : success('b'),
  async () => { waits++ }), success('b'))
assert.equal(busyAttempts, 3)
assert.equal(waits, 2)
let releaseFirst: (() => void) | undefined
const firstUpload = new Promise<void>(resolve => { releaseFirst = resolve })
const inFlight: string[] = []
const queued = shareSelection(['first', 'second'], async path => {
  inFlight.push(path)
  if (path === 'first') await firstUpload
  return success(path)
})
assert.deepEqual(inFlight, ['first'])
releaseFirst!()
assert.deepEqual((await queued).urls, ['first', 'second'])
assert.deepEqual(inFlight, ['first', 'second'])

const calls: string[] = []
const progress: string[] = []
const first = await shareSelection(['a', 'b', 'c'], async path => {
  calls.push(path)
  assert.deepEqual(calls, ['a', 'b', 'c'].slice(0, calls.length))
  if (path === 'b') throw new Error('network failure')
  return success(path)
}, state => progress.push(`${state.completed} of ${state.total}; ${state.failed} failed`))
assert.deepEqual(calls, ['a', 'b', 'c'])
assert.deepEqual(progress, ['1 of 3; 0 failed', '2 of 3; 1 failed', '3 of 3; 1 failed'])
assert.deepEqual(first, { completed: 3, total: 3, failed: 1, urls: ['a', 'c'], stoppedBy: null })

for (const error of ['Too many links this hour. Try again later.', 'The share server is full right now.']) {
  const attempted: string[] = []
  const result = await shareSelection(['a', 'b', 'c'], async path => {
    attempted.push(path)
    return path === 'b' ? { ok: false, error } : success(path)
  })
  assert.deepEqual(attempted, ['a', 'b'])
  assert.deepEqual(result, { completed: 2, total: 3, failed: 1, urls: ['a'], stoppedBy: error })
}

const ordinary = await shareSelection(['a', 'b'], async path =>
  path === 'a' ? { ok: false, error: 'The server refused this clip as too big.' } : success(path))
assert.deepEqual(ordinary, { completed: 2, total: 2, failed: 1, urls: ['b'], stoppedBy: null })
assert.deepEqual(await shareSelection([], async () => success('unused')),
  { completed: 0, total: 0, failed: 0, urls: [], stoppedBy: null })

let stop = false
const stoppedCalls: string[] = []
const stopped = await shareSelection(['a', 'b', 'c'], async path => {
  stoppedCalls.push(path)
  return success(path)
}, progress => { if (progress.completed === 1) stop = true }, () => stop)
assert.deepEqual(stoppedCalls, ['a'])
assert.deepEqual(stopped, { completed: 1, total: 3, failed: 0, urls: ['a'], stoppedBy: null })

let stopInFlight = false
let finishUpload: (() => void) | undefined
const upload = new Promise<void>(resolve => { finishUpload = resolve })
const inFlightCalls: string[] = []
const stopping = shareSelection(['first', 'second'], async path => {
  inFlightCalls.push(path)
  await upload
  return success(path)
}, undefined, () => stopInFlight)
stopInFlight = true
finishUpload!()
assert.deepEqual((await stopping).urls, ['first'])
assert.deepEqual(inFlightCalls, ['first'])

let stopQueued = false
let queuedAttempts = 0
const queuedStop = await shareSelection(['b', 'c'], path => shareWhenAvailable(path, async () => {
  queuedAttempts++
  return { ok: false, error: 'A link is already being made' }
}, async () => { stopQueued = true }, () => stopQueued), undefined, () => stopQueued)
assert.equal(queuedAttempts, 1)
assert.deepEqual(queuedStop, { completed: 0, total: 2, failed: 0, urls: [], stoppedBy: null })

console.log('share selection self-check passed')
