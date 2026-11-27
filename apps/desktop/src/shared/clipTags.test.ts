import { strict as assert } from 'node:assert'
import { changeClipTag, normalizeClipTags } from './clipTags.ts'
import { parseSidecar, serialiseSidecar } from './clipFiles.ts'

assert.deepEqual(normalizeClipTags(['  Big   Win ', 'big win', '  Boss\tFight  ']), ['Big Win', 'Boss Fight'])
assert.deepEqual(normalizeClipTags(['', '  ', 'One']), ['One'])
assert.deepEqual(normalizeClipTags([]), [])
assert.equal(normalizeClipTags('one'), null)
assert.equal(normalizeClipTags([1]), null)
assert.equal(normalizeClipTags(['x'.repeat(25)]), null)
assert.deepEqual(normalizeClipTags(['x'.repeat(24)]), ['x'.repeat(24)])
assert.deepEqual(normalizeClipTags(Array(9).fill('Same')), ['Same'])
assert.equal(normalizeClipTags(Array.from({ length: 9 }, (_, i) => String(i))), null)
assert.deepEqual(parseSidecar('{"starred":true,"game":"Arena"}').tags, undefined)
assert.deepEqual(parseSidecar(serialiseSidecar({ ...parseSidecar('{"starred":true,"game":"Arena"}'), tags: ['Win'] })),
  { starred: true, game: 'Arena', tags: ['Win'] })
assert.throws(() => parseSidecar('{"starred":true,"tags":"invalid"}'))

assert.deepEqual(normalizeClipTags(['\u200b', '\u0007', 'One']), ['One'])
assert.deepEqual(parseSidecar(JSON.stringify({ starred: true, tags: ['Win', 'x'.repeat(25), 3, 'win', 'Boss'] })),
  { starred: true, tags: ['Win', 'Boss'] })

assert.deepEqual(changeClipTag(['Win'], ' win ', 'add'), ['Win'])
assert.deepEqual(changeClipTag(['Win', 'Boss'], ' WIN ', 'remove'), ['Boss'])
assert.deepEqual(changeClipTag(['Win'], 'New', 'add'), ['Win', 'New'])
assert.equal(changeClipTag(Array.from({ length: 8 }, (_, i) => String(i)), 'Extra', 'add'), null)
assert.equal(changeClipTag([], ' '.repeat(3), 'add'), null)
assert.equal(changeClipTag([], 'Win', 'replace'), null)

console.log('clipTags self-check passed')
