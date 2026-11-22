// Self-check for share-link helpers. Run with:
//   node --experimental-strip-types src/shared/shareLink.test.ts
import { strict as assert } from 'node:assert'
import {
  SHARE_MAX_BYTES, SHARE_PAGE_ORIGIN, SHARE_TARGET_KBPS, SHARE_UPLOAD_ENDPOINT, checkShareSize,
  parseFlashLink, shareCopyMaxBytes, shareUrlFromPath,
} from './shareLink.ts'

assert.equal(SHARE_UPLOAD_ENDPOINT, 'https://share.flashclipping.fyi/flash-clips')

assert.equal(checkShareSize(1), null)
assert.equal(checkShareSize(SHARE_MAX_BYTES), null)
assert.match(checkShareSize(SHARE_MAX_BYTES + 1) ?? '', /over 100MB/)
assert.equal(checkShareSize(0), 'The clip is empty.')
assert.equal(checkShareSize(Number.NaN), 'The clip is empty.')

const fifteenSecondsAt16Mbps = 15 * 16000 * 1000 / 8
assert.equal(
  shareCopyMaxBytes({ durationSeconds: 15, fileBytes: fifteenSecondsAt16Mbps }),
  Math.ceil(15 * SHARE_TARGET_KBPS * 1000 / 8),
)
assert.equal(shareCopyMaxBytes({ durationSeconds: 15, fileBytes: 15 * 5500 * 1000 / 8 }), null)
for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(shareCopyMaxBytes({ durationSeconds, fileBytes: fifteenSecondsAt16Mbps }), null)
}
assert.equal(shareCopyMaxBytes({ durationSeconds: 0.1, fileBytes: 1048576 }), 1048576)

assert.equal(shareUrlFromPath('/c/AbC_-12345xY.mp4'), `${SHARE_PAGE_ORIGIN}/c/AbC_-12345xY`)
// Anything off-shape is refused, so a hostile reply cannot steer the link.
for (const bad of [undefined, null, 42, '', '/c/short.mp4', 'https://evil.example/c/AbC_-12345xY.mp4',
  '/c/../x.mp4', '/c/AbC_-12345xY.mp4?x=1', '//evil.example/c/AbC_-12345xY.mp4']) {
  assert.equal(shareUrlFromPath(bad), null, String(bad))
}

assert.deepEqual(parseFlashLink('flash://c/AbC_-12345xY'), {
  id: 'AbC_-12345xY',
  mp4Url: 'https://share.flashclipping.fyi/c/AbC_-12345xY.mp4',
})
assert.deepEqual(parseFlashLink('flash://c/AbC_-12345xY/'), {
  id: 'AbC_-12345xY',
  mp4Url: 'https://share.flashclipping.fyi/c/AbC_-12345xY.mp4',
})
for (const bad of [
  '', 'flash://c/short', 'FLASH://c/AbC_-12345xY', 'flash://other/AbC_-12345xY',
  'flash://c/AbC_-12345xY/extra', 'flash://c/AbC_-12345xY?next=evil',
  'flash://c/AbC_-12345xY#fragment', 'flash://c/AbC_-12345x%59',
  'flash://user@c/AbC_-12345xY', 'https://c/AbC_-12345xY',
]) {
  assert.equal(parseFlashLink(bad), null, bad)
}

console.log('shareLink self-check passed')
