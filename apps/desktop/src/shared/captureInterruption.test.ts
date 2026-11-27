import { strict as assert } from 'node:assert'
import { captureInterruptionNotice } from './captureInterruption.ts'

const message = 'Capture stopped: display disconnected'
assert.equal(captureInterruptionNotice(true, message, -Infinity, 1000), message)
assert.equal(captureInterruptionNotice(true, message, 1000, 2000), undefined, 'retries must not spam the user')
assert.equal(captureInterruptionNotice(true, message, 1000, 61_000), message)
assert.equal(captureInterruptionNotice(false, message, -Infinity, 1000), undefined, 'manual stops are not interruptions')

console.log('capture interruption self-check passed')
