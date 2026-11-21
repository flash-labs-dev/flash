import { strict as assert } from 'node:assert'
import test from 'node:test'
import worker from './worker.js'

const VALID_ID = 'AbC_-12345xY'
const PAGE_URL = `https://flashclipping.fyi/c/${VALID_ID}`
const VIDEO_URL = `https://share.flashclipping.fyi/c/${VALID_ID}.mp4`

async function withFetch(responseOrError, run) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    if (responseOrError instanceof Error) throw responseOrError
    return responseOrError
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('valid id returns the watch page with video metadata', async () => {
  await withFetch(new Response(null, { status: 200 }), async (calls) => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(html, /property="og:video"/)
    assert.match(html, new RegExp(VIDEO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], VIDEO_URL)
    assert.equal(calls[0][1].method, 'HEAD')
  })
})

test('missing clip returns the gone page', async () => {
  await withFetch(new Response(null, { status: 404 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    assert.equal(response.status, 410)
    assert.match(await response.text(), /This clip has expired\./)
  })
})

test('share server error returns an uncached unavailable page', async () => {
  await withFetch(new Response(null, { status: 500 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(await response.text(), /can’t load this clip right now/i)
  })
})

test('bad id returns 404 without contacting the share server', async () => {
  await withFetch(new Error('fetch should not run'), async (calls) => {
    const response = await worker.fetch(new Request('https://flashclipping.fyi/c/%3Cscript%3Ealert(1)%3C/script%3E'))
    assert.equal(response.status, 404)
    assert.equal(calls.length, 0)
    assert.doesNotMatch(await response.text(), /script|alert/)
  })
})

test('.mp4 route redirects to the share origin', async () => {
  await withFetch(new Error('fetch should not run'), async (calls) => {
    const response = await worker.fetch(new Request(`${PAGE_URL}.mp4`), { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), VIDEO_URL)
    assert.equal(calls.length, 0)
  })
})

test('Last-Modified produces remaining lifetime text', async () => {
  const modified = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000))
  await withFetch(new Response(null, { status: 200, headers: { 'Last-Modified': modified.toUTCString() } }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    assert.match(await response.text(), /expires in 5 days/)
  })
})

test('missing Last-Modified omits expiry text', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.doesNotMatch(html, /expires (?:in|today)/)
    assert.match(html, />Shared clip</)
  })
})
