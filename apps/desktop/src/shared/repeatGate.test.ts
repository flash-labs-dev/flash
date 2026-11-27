// Run with: node --experimental-strip-types src/shared/repeatGate.test.ts
import { strict as assert } from 'node:assert'
import { repeatGate } from './repeatGate.ts'

const press = repeatGate(1000)
assert.equal(press(0), true)
for (let time = 500; time < 5000; time += 30) assert.equal(press(time), false)
assert.equal(press(6000), true)
