import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import worker from './worker.js'

const VALID_ID = 'AbC_-12345xY'
const PAGE_URL = `https://flashclipping.fyi/c/${VALID_ID}`
const VIDEO_URL = `https://share.flashclipping.fyi/c/${VALID_ID}.mp4`
const SAVE_URL = `/c/${VALID_ID}.mp4`
const FEEDBACK_URL = 'https://flashclipping.fyi/api/feedback'
const UPSTREAM_URL = 'https://upstream.invalid/flash-feedback'

function feedbackRequest(body = '{}', headers = {}) {
  return new Request(FEEDBACK_URL, { method: 'POST', body, headers })
}

async function assertFeedbackResponse(response, status) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(await response.text(), '')
  assert.doesNotMatch([...response.headers].join(' '), /upstream\.invalid/)
}

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

test('feedback forwards the raw body to the configured upstream', async () => {
  await withFetch(new Response(null, { status: 204 }), async (calls) => {
    const body = '{"message":"hello"}'
    await assertFeedbackResponse(await worker.fetch(feedbackRequest(body, { 'CF-Connecting-IP': '192.0.2.1', 'X-Other': 'private' }), {
      FEEDBACK_UPSTREAM: UPSTREAM_URL,
    }), 204)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], UPSTREAM_URL)
    assert.equal(calls[0][1].method, 'POST')
    assert.equal(new TextDecoder().decode(calls[0][1].body), body)
    assert.equal(calls[0][1].headers['Content-Type'], 'application/json')
    assert.equal(calls[0][1].headers['X-Other'], undefined)
    assert.equal(calls[0][1].redirect, 'manual')
    assert.ok(calls[0][1].signal)
  })
})

test('feedback rejects other methods and missing configuration', async () => {
  const rejected = await worker.fetch(new Request(FEEDBACK_URL))
  await assertFeedbackResponse(rejected, 405)
  assert.equal(rejected.headers.get('allow'), 'POST')
  await assertFeedbackResponse(await worker.fetch(feedbackRequest()), 503)
})

test('feedback limiter rejects before calling upstream', async () => {
  await withFetch(new Error('unexpected upstream call'), async (calls) => {
    let key
    const response = await worker.fetch(feedbackRequest(), {
      FEEDBACK_UPSTREAM: UPSTREAM_URL,
      FEEDBACK_LIMITER: { async limit(input) { key = input.key; return { success: false } } },
    })
    await assertFeedbackResponse(response, 429)
    assert.equal(key, 'unknown')
    assert.equal(calls.length, 0)
  })
})

test('feedback rejects oversized bodies before calling upstream', async () => {
  await withFetch(new Error('unexpected upstream call'), async (calls) => {
    const env = { FEEDBACK_UPSTREAM: UPSTREAM_URL }
    await assertFeedbackResponse(await worker.fetch(feedbackRequest('x'.repeat(4097)), env), 413)
    await assertFeedbackResponse(await worker.fetch(feedbackRequest(''), env), 413)
    assert.equal(calls.length, 0)
  })
})

test('feedback key headers are sent only when configured', async () => {
  await withFetch(new Response(null, { status: 204 }), async (calls) => {
    const request = () => feedbackRequest('{}', { 'CF-Connecting-IP': '192.0.2.2' })
    await worker.fetch(request(), { FEEDBACK_UPSTREAM: UPSTREAM_URL })
    await worker.fetch(request(), { FEEDBACK_UPSTREAM: UPSTREAM_URL, FEEDBACK_KEY: 'secret' })
    assert.equal(calls[0][1].headers['X-Flash-Proxy-Key'], undefined)
    assert.equal(calls[0][1].headers['X-Flash-Client-IP'], undefined)
    assert.equal(calls[1][1].headers['X-Flash-Proxy-Key'], 'secret')
    assert.equal(calls[1][1].headers['X-Flash-Client-IP'], '192.0.2.2')
  })
})

test('feedback upstream failure returns 502', async () => {
  await withFetch(new Error('offline'), async () => {
    await assertFeedbackResponse(await worker.fetch(feedbackRequest(), { FEEDBACK_UPSTREAM: UPSTREAM_URL }), 502)
  })
})

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
  assert.doesNotMatch(html, /discord:component-embed/)
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

test('a live clip carries a Discord component embed with only the playable video', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const html = await (await worker.fetch(new Request(PAGE_URL))).text()
    const head = html.slice(0, html.indexOf('</head>'))
    const found = head.match(/<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/)
    assert.ok(found)
    assert.ok(new TextEncoder().encode(found[1]).length <= 3000)
    assert.deepEqual(JSON.parse(found[1]), {
      component: { type: 17, components: [{ type: 12, items: [{ media: { url: VIDEO_URL } }] }] },
    })
  })
  await withFetch(new Response(null, { status: 404 }), async () => {
    assert.doesNotMatch(await (await worker.fetch(new Request(PAGE_URL))).text(), /discord:component-embed/)
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
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(html, /This clip has expired\./)
    assert.match(html, /<div class="empty"/)
    assertNoClipActions(html)
    assertSharedShell(html)
  })
})

test('known clip routes reject unsupported methods with Allow while unknown paths stay 404', async () => {
  const known = await worker.fetch(new Request(PAGE_URL, { method: 'POST' }))
  assert.equal(known.status, 405)
  assert.equal(known.headers.get('allow'), 'GET, HEAD')
  assert.equal((await worker.fetch(new Request('https://flashclipping.fyi/no-such-page'))).status, 404)
})

test('release selection skips incomplete releases and unsafe asset URLs on both pages', async () => {
  const releases = [
    { draft: false, tag_name: 'v2', assets: [{ name: 'Flash-Setup.exe', size: 9, browser_download_url: 'javascript:alert(1)' }] },
    { draft: false, tag_name: 'v1', assets: [
      { name: 'Flash-Setup.exe', size: 104857600, browser_download_url: 'https://github.com/flash-labs-dev/flash/releases/download/v1/Flash-Setup.exe' },
      { name: 'Flash.AppImage', size: 104857600, browser_download_url: 'https://github.com/flash-labs-dev/flash/releases/download/v1/Flash.AppImage' },
    ] },
  ]
  const makeButton = () => ({ href: 'fallback', querySelector: () => ({ textContent: '' }) })
  const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const indexRelease = index.match(/^function validAsset\(.*\r?\nfunction newestAsset\(.*\r?\nfetch\('https:\/\/api\.github\.com\/repos\/'.*\.catch\(function\(\)\{\}\);/m)?.[0]
  assert.ok(indexRelease)
  const winBtn = makeButton(), linBtn = makeButton(), heroDl = makeButton()
  const versions = [{ textContent: 'fallback' }]
  runInNewContext(indexRelease, {
    REPO: 'flash-labs-dev/flash', linux: false, phone: false, winBtn, linBtn, heroDl,
    mb: n => `${Math.round(n / 1048576)} MB`,
    document: { querySelectorAll: () => versions },
    URL,
    fetch: async () => ({ ok: true, json: async () => releases }),
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(winBtn.href, /\/v1\/Flash-Setup\.exe$/)
  assert.match(linBtn.href, /\/v1\/Flash\.AppImage$/)
  assert.equal(versions[0].textContent, 'v1')

  await withFetch(new Response(null, { status: 200 }), async () => {
    const html = await (await worker.fetch(new Request(PAGE_URL))).text()
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script)
    const workerRelease = script.match(/var validAsset = function[\s\S]*?\.catch\(function \(\) \{\}\);/)?.[0]
    assert.ok(workerRelease)
    const buttons = [makeButton(), makeButton()]
    runInNewContext(workerRelease, {
      releasesUrl: 'https://api.github.com/', linux: true, buttons,
      URL,
      fetch: async () => ({ ok: true, json: async () => releases }),
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(buttons[0].href, /\/v1\/Flash\.AppImage$/)
  })
})

test('GitHub rate limits and malformed release data leave safe fallback links in place', async () => {
  const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const code = index.match(/^function validAsset\(.*\r?\nfunction newestAsset\(.*\r?\nfetch\('https:\/\/api\.github\.com\/repos\/'.*\.catch\(function\(\)\{\}\);/m)?.[0]
  assert.ok(code)
  for (const response of [{ ok: false, status: 429 }, { ok: true, json: async () => { throw new Error('invalid JSON') } }, { ok: true, json: async () => ({ message: 'rate limited' }) }]) {
    const winBtn = { href: 'windows-fallback' }
    const linBtn = { href: 'linux-fallback' }
    const heroDl = { href: 'windows-fallback' }
    runInNewContext(code, {
      REPO: 'flash-labs-dev/flash', linux: false, phone: false, winBtn, linBtn, heroDl,
      URL, Number, Array, document: { querySelectorAll: () => [] },
      fetch: async () => response,
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(winBtn.href, 'windows-fallback')
    assert.equal(linBtn.href, 'linux-fallback')
    assert.equal(heroDl.href, 'windows-fallback')
  }
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

test('tap for sound sits at the top of the player, clear of the native video controls', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const html = await (await worker.fetch(new Request(PAGE_URL))).text()
    const rule = html.match(/\.unmute \{([^}]*)\}/)[1]
    assert.match(rule, /\btop:16px;/)
    assert.doesNotMatch(rule, /\bbottom:/)
  })
})

test('launch card heading has a correctly encoded ellipsis', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const html = await (await worker.fetch(new Request(PAGE_URL))).text()
    assert.match(html, /<h2 id="launch-title">Opening in Flash…<\/h2>/)
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

test('launch dialog keeps keyboard focus inside and returns it on dismissal', async () => {
  await withFetch(new Response(null, { status: 200 }), async () => {
    const html = await (await worker.fetch(new Request(PAGE_URL))).text()
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    const launchCode = script?.match(/var launch = document\.getElementById\('launch'\);[\s\S]*?setTimeout\(dismissLaunch, 5000\);\s*\}/)?.[0]
    assert.ok(launchCode)
    const handlers = {}
    const previous = { focus() { document.activeElement = previous } }
    const launch = { hidden: true }
    const browser = { checked: false, focus() { document.activeElement = browser }, addEventListener() {} }
    const watch = { focus() { document.activeElement = watch }, addEventListener(type, handler) { handlers[type] = handler } }
    const elements = { launch, 'launch-watch': watch, 'launch-browser': browser }
    const document = {
      activeElement: previous,
      getElementById: id => elements[id],
      addEventListener(type, handler) { handlers[type] = handler },
      createElement: () => ({ setAttribute() {} }),
      body: { appendChild() {} },
    }
    runInNewContext(launchCode, {
      document, window: { matchMedia: () => ({ matches: false }) }, ua: '', video: {},
      localStorage: { getItem: () => null }, setTimeout() {},
    })
    assert.equal(document.activeElement, watch)
    let prevented = false
    handlers.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(document.activeElement, browser)
    handlers.keydown({ key: 'Escape' })
    assert.equal(launch.hidden, true)
    assert.equal(document.activeElement, previous)
  })
})
