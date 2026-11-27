// Run with: node --experimental-strip-types src/shared/outputSpace.test.ts
import { strict as assert } from 'node:assert'
import { outputSpaceError } from './outputSpace.ts'

assert.match(outputSpaceError(80 * 1024 ** 2, 100 * 1024 ** 2) ?? '', /Not enough free space/)
assert.equal(outputSpaceError(200 * 1024 ** 2, 100 * 1024 ** 2), null)
