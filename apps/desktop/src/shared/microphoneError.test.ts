// Run with: node --experimental-strip-types src/shared/microphoneError.test.ts
import { strict as assert } from 'node:assert'
import { microphoneError } from './microphoneError.ts'

assert.equal(microphoneError('process loopback unavailable; Microphone: microphone access denied by Windows', true),
  'Microphone: microphone access denied by Windows')
assert.equal(microphoneError('process loopback unavailable', true), undefined)
assert.equal(microphoneError('Microphone: default endpoint unavailable', false), undefined)
