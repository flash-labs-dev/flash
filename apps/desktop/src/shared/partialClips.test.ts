import assert from 'node:assert/strict'
import { isStalePartialClip } from './partialClips.ts'

const now = 10 * 60 * 60 * 1000
const ts = '2026-11-11_19-36-34'
for (const name of [
  `${ts}.1234.0.partial.mp4`,
  `${ts}.1234.7.partial.png`,
  `${ts}.mp4.partial.0f8fad5b-d9cb-469f-a165-70867728950e`,
  `${ts}.mp4.A1b2C3`,
  `${ts}_10.mp4.qwErty`,
  // Derived outputs, including from a renamed clip
  `${ts} - trim.1234.0.partial.mp4`,
  'holiday - edit (2).1234.0.partial.mp4',
  'holiday - trim - 10MB H264.1234.1.partial.mp4.try.mp4',
  'holiday - 50MB.mp4.A1b2C3',
  'holiday - 1GB.1234.0.partial.mp4',
  `${ts} (2).mp4.partial.0f8fad5b-d9cb-469f-a165-70867728950e`
]) {
  assert.equal(isStalePartialClip(name, now - 3600001, now), true, name)
  assert.equal(isStalePartialClip(name, now - 3600000, now), false, name)
}
for (const name of [
  `${ts}.mp4`, `${ts}.mp4.A1b2C`, `${ts}.mp4.A1b2C3x`, `${ts}.mp4.backup`,
  'holiday.mp4.A1b2C3', 'holiday.1234.0.partial.mp4', 'holiday.1234.0.partial.png',
  'holiday.mp4.partial.0f8fad5b-d9cb-469f-a165-70867728950e',
  `${ts}_notes.mp4.A1b2C3`,
  'report.partial.docx', 'movie.partial.mp4', 'notes.mp4.partial.old'
]) {
  assert.equal(isStalePartialClip(name, now - 7200000, now), false, name)
}
const partial = `${ts}.1.0.partial.mp4`
assert.equal(isStalePartialClip(partial, Number.NaN, now), false)
assert.equal(isStalePartialClip(partial, now + 1, now), false)

console.log('partial clip self-check passed')
