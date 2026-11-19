// Self-check for share-link helpers. Run with:
//   node --experimental-strip-types src/shared/shareLink.test.ts
import { strict as assert } from 'node:assert'
import {
  SHARE_MAX_BYTES, SHARE_ORIGIN, SHARE_UPLOAD_ENDPOINT, checkShareSize, shareUrlFromPath,
} from './shareLink.ts'

assert.equal(SHARE_UPLOAD_ENDPOINT, 'https://lubuntuserver.tail857ab5.ts.net:10000/flash-clips')

assert.equal(checkShareSize(1), null)
assert.equal(checkShareSize(SHARE_MAX_BYTES), null)
assert.match(checkShareSize(SHARE_MAX_BYTES + 1) ?? '', /over 100MB/)
assert.equal(checkShareSize(0), 'The clip is empty.')
assert.equal(checkShareSize(Number.NaN), 'The clip is empty.')

assert.equal(shareUrlFromPath('/c/AbC_-12345xY.mp4'), `${SHARE_ORIGIN}/c/AbC_-12345xY.mp4`)
// Anything off-shape is refused, so a hostile reply cannot steer the link.
for (const bad of [undefined, null, 42, '', '/c/short.mp4', 'https://evil.example/c/AbC_-12345xY.mp4',
  '/c/../x.mp4', '/c/AbC_-12345xY.mp4?x=1', '//evil.example/c/AbC_-12345xY.mp4']) {
  assert.equal(shareUrlFromPath(bad), null, String(bad))
}

console.log('shareLink self-check passed')
