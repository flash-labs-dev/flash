import { strict as assert } from 'node:assert'
import { pruneStorageClips } from './storagePrune.ts'

const clip = (filePath: string, size: number, createdAt: number, eligible = true) => ({ filePath, size, createdAt, eligible })
const clips = [
  clip('e.mp4', 4, 50), clip('a.mp4', 3, 10), clip('starred.mp4', 8, 1, false),
  clip('b.mp4', 5, 20), clip('c.mp4', 2, 30), clip('d.mp4', 2, 40),
]
async function removedPaths(input: typeof clips, limit: number): Promise<string[]> {
  const paths: string[] = []
  await pruneStorageClips(input, limit, async path => { paths.push(path); return true })
  return paths
}
assert.deepEqual(await removedPaths(clips, 0), [])
assert.deepEqual(await removedPaths(clips, 24), [])
assert.deepEqual(await removedPaths(clips, 21), ['a.mp4'])
assert.deepEqual(await removedPaths(clips, 17), ['a.mp4', 'b.mp4'])
// The three newest stay even when the limit is still exceeded.
assert.deepEqual(await removedPaths(clips, 9), [])
assert.deepEqual(await removedPaths(clips, 16), ['a.mp4', 'b.mp4'])
// Starred, just-saved, and the newest three together exceed the limit.
assert.deepEqual(await removedPaths([...clips, clip('just-saved.mp4', 4, 60, false)], 14), [])
let impossible = 0
assert.equal(await pruneStorageClips(clips, 9, async () => { throw new Error('must not delete') }, () => { impossible++ }), 0)
assert.equal(impossible, 1)
// Starred clips alone fill the limit: nothing is deleted.
assert.deepEqual(await removedPaths(clips, 8), [])
assert.deepEqual(await removedPaths([clip('unreadable.mp4', 10, 1, false), clip('protected.mp4', 10, 2, false)], 1), [])
assert.deepEqual(clips.map(c => c.filePath), ['e.mp4', 'a.mp4', 'starred.mp4', 'b.mp4', 'c.mp4', 'd.mp4'])
const attempted: string[] = []
assert.equal(await pruneStorageClips(clips, 21, async path => {
  attempted.push(path)
  return path !== 'a.mp4'
}), 1)
assert.deepEqual(attempted, ['a.mp4', 'b.mp4'])
console.log('PASS: storage pruning order, protected clips, newest kept, off setting')
import { sanitise } from './sanitise.ts'
const defaults = { maxStorageGB: 0 }
for (const maxStorageGB of [0, 1, 5, 10, 25, 50, 100]) {
  assert.deepEqual(sanitise(defaults, { maxStorageGB }), { maxStorageGB })
}
for (const maxStorageGB of [-1, 2, 1.5, NaN, Infinity, '5']) {
  assert.deepEqual(sanitise(defaults, { maxStorageGB }), {})
}
