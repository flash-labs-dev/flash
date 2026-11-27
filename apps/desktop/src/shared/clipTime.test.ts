// Run with: node --experimental-strip-types src/shared/clipTime.test.ts
import { strict as assert } from 'node:assert'
import { rangeCutoff } from './clipTime.ts'

const now = new Date(2026, 10, 26, 15, 42).getTime()
assert.equal(rangeCutoff('any', now), null)
assert.equal(rangeCutoff('today', now), new Date(2026, 10, 26).getTime())
assert.equal(rangeCutoff('7days', now), now - 7 * 86400000)
assert.equal(rangeCutoff('30days', now), now - 30 * 86400000)

console.log('clip time self-check passed')
