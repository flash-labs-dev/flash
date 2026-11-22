import { strict as assert } from 'node:assert'
import test from 'node:test'
import worker from './worker.js'

const VALID_ID = 'AbC_-12345xY'
const PAGE_URL = `https://flashclipping.fyi/c/${VALID_ID}`
const VIDEO_URL = `https://share.flashclipping.fyi/c/${VALID_ID}.mp4`
const SAVE_URL = `/c/${VALID_ID}.mp4`

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

function occurrences(value, fragment) {
  return value.split(fragment).length - 1
}

function assertSharedShell(html) {
  assert.equal(occurrences(html, 'class="btn solid download-link"'), 2)
  assert.match(html, /<aside class="side">/)
  assert.match(html, /<div class="keycap">F8<\/div>/)
  assert.match(html, /Free, no account/)
  assert.match(html, /Always recording/)
  assert.match(html, /Windows and Linux/)
}

function assertNoClipActions(html) {
  assert.doesNotMatch(html, /<video\b/)
  assert.doesNotMatch(html, /id="unmute"/)
  assert.doesNotMatch(html, /id="copy"/)
  assert.doesNotMatch(html, />Save clip</)
  assert.doesNotMatch(html, /id="launch"/)
}

test('valid id returns the rebuilt watch page with one HTML video and clip actions', async () => {
  await withFetch(new Response(null, { status: 200 }), async (calls) => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(html, /property="og:video"/)
    assert.match(html, new RegExp(VIDEO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(occurrences(html, '<video'), 1)
    assert.match(html, /<video id="clip" controls autoplay muted loop playsinline preload="metadata"/)
    assert.match(html, /aria-label="Shared Flash clip"/)
    assert.match(html, />Tap for sound</)
    assert.match(html, /id="copy"/)
    assert.match(html, new RegExp(`href="${SAVE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
    assert.match(html, /role="status"/)
    assert.match(html, /id="launch" role="dialog" aria-modal="true"/)
    assert.match(html, new RegExp(`flash:\\/\\/c\\/${VALID_ID}`))
    assert.match(html, /\(pointer: coarse\)/)
    assert.match(html, /\(hover: none\)/)
    assert.match(html, /Android\|iPhone\|iPad\|Mobile/)
    assert.match(html, /flashWatchInBrowser/)
    assert.match(html, /setTimeout\(dismissLaunch, 5000\)/)
    assertSharedShell(html)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], VIDEO_URL)
    assert.equal(calls[0][1].method, 'HEAD')
  })
})

test('Last-Modified renders one expiry pill', async () => {
  const modified = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000))
  await withFetch(new Response(null, { status: 200, headers: { 'Last-Modified': modified.toUTCString() } }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.match(html, /<span class="pill"><i><\/i>expires in 5 days<\/span>/)
    assert.equal(occurrences(html, '<span class="pill">'), 1)
  })
})

test('missing Last-Modified drops the expiry pill entirely', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.doesNotMatch(html, /<span class="pill">/)
    assert.doesNotMatch(html, /expires (?:in|today)/)
    assert.match(html, /<h1 class="title">Shared clip<\/h1>/)
  })
})

test('expired state keeps the shell but has no video, unmute, copy, or save action', async () => {
  await withFetch(new Response(null, { status: 404 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(response.status, 410)
    assert.match(html, /This clip has expired\./)
    assert.match(html, /<div class="empty"/)
    assertNoClipActions(html)
    assertSharedShell(html)
  })
})

test('unavailable state is uncached and has no clip controls or actions', async () => {
  await withFetch(new Response(null, { status: 500 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(html, /Can’t load this clip right now\./)
    assertNoClipActions(html)
    assertSharedShell(html)
  })
})

test('share fetch failure returns the same uncached unavailable state', async () => {
  await withFetch(new Error('offline'), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(html, /Can’t load this clip right now\./)
    assertNoClipActions(html)
  })
})

test('invalid and hostile input is not reflected or sent to the share server', async () => {
  await withFetch(new Error('fetch should not run'), async (calls) => {
    const response = await worker.fetch(new Request('https://flashclipping.fyi/c/%3Cscript%3Ealert(1)%3C/script%3E'))
    assert.equal(response.status, 404)
    assert.equal(calls.length, 0)
    assert.doesNotMatch(await response.text(), /script|alert/)
  })

  await withFetch(new Response(null, { status: 200, headers: { 'Last-Modified': '<img src=x onerror=alert(1)>' } }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.doesNotMatch(html, /<img src=x|onerror=|alert\(1\)/)
  })
})

test('launch links are built only after the twelve-character id is validated', async () => {
  await withFetch(new Response(null, { status: 200 }), async (calls) => {
    const response = await worker.fetch(new Request('https://flashclipping.fyi/c/AbC_-12345xYextra'))
    assert.equal(response.status, 404)
    assert.equal(calls.length, 0)
    assert.doesNotMatch(await response.text(), /flash:\/\/c\//)
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

test('HEAD returns the watch status and headers without a body', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL, { method: 'HEAD' }))
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  })
})

test('both download buttons use beta.5 fallbacks and inline page JavaScript parses', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const response = await worker.fetch(new Request(PAGE_URL))
    const html = await response.text()
    assert.equal(occurrences(html, 'releases/download/v0.1.0-beta.5/Flash-Setup-0.1.0-beta.5.exe'), 3)
    assert.match(html, /releases\/download\/v0\.1\.0-beta\.5\/Flash-0\.1\.0-beta\.5\.AppImage/)
    assert.doesNotMatch(html, /beta\.4/)
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length, 1)
    assert.doesNotThrow(() => new Function(scripts[0][1]))
  })
})
