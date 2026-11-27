import { strict as assert } from 'node:assert'
import { audioEditsPending } from './unsavedAudio.ts'

const ids = ['game', 'mic']
assert.equal(audioEditsPending(ids, {}), false)
assert.equal(audioEditsPending(ids, { game: 1, mic: 1 }), false)
assert.equal(audioEditsPending(ids, { mic: 0 }), true)
assert.equal(audioEditsPending(ids, { game: 1.5 }), true)
assert.equal(audioEditsPending([], { mic: 0 }), false)

console.log('PASS: unsaved audio edits are detected')
