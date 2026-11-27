import { strict as assert } from 'node:assert'
import { selectCaptureDisplay } from './displaySelection.ts'

const original = [
  { id: 0, name: 'LEFT', isPrimary: false },
  { id: 1, name: 'PRIMARY', isPrimary: true },
  { id: 2, name: 'RIGHT', isPrimary: false },
]
assert.equal(selectCaptureDisplay(original, 2, 'RIGHT')?.name, 'RIGHT')
assert.equal(selectCaptureDisplay(original.slice(1).map((display, id) => ({ ...display, id })), 2, 'RIGHT')?.id, 1)
assert.equal(selectCaptureDisplay(original.slice(1).map((display, id) => ({ ...display, id })), 0, 'LEFT')?.name, 'PRIMARY')
assert.equal(selectCaptureDisplay(original, 2, '')?.name, 'RIGHT') // legacy numeric setting
console.log('capture display selection self-check passed')
