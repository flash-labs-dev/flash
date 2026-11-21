const SHARE_ORIGIN = 'https://share.flashclipping.fyi'
const SITE_ORIGIN = 'https://flashclipping.fyi'
const RELEASES_URL = 'https://api.github.com/repos/flash-labs-dev/flash/releases?per_page=5'
const WINDOWS_FALLBACK = 'https://github.com/flash-labs-dev/flash/releases/download/v0.1.0-beta.4/Flash-Setup-0.1.0-beta.4.exe'
const LINUX_FALLBACK = 'https://github.com/flash-labs-dev/flash/releases/download/v0.1.0-beta.4/Flash-0.1.0-beta.4.AppImage'
const CLIP_ID = /^[A-Za-z0-9_-]{12}$/
const DAY_MS = 24 * 60 * 60 * 1000

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function expiryText(lastModified) {
  if (!lastModified) return ''
  const modifiedAt = Date.parse(lastModified)
  if (!Number.isFinite(modifiedAt)) return ''
  const days = Math.max(0, Math.ceil((modifiedAt + (7 * DAY_MS) - Date.now()) / DAY_MS))
  return days === 0 ? 'expires today' : `expires in ${days} ${days === 1 ? 'day' : 'days'}`
}

function pageTemplate({ title, meta, caption, videoUrl = '', canonicalUrl = '' }) {
  const safeTitle = escapeHtml(title)
  const safeMeta = escapeHtml(meta)
  const safeCaption = escapeHtml(caption)
  const safeVideoUrl = escapeHtml(videoUrl)
  const safeCanonicalUrl = escapeHtml(canonicalUrl || SITE_ORIGIN)
  const videoMeta = videoUrl ? `
<meta property="og:type" content="video.other">
<meta property="og:video" content="${safeVideoUrl}">
<meta property="og:video:secure_url" content="${safeVideoUrl}">
<meta property="og:video:type" content="video/mp4">
<meta name="twitter:card" content="player">
<meta name="twitter:player" content="${safeCanonicalUrl}">
<meta name="twitter:player:width" content="1280">
<meta name="twitter:player:height" content="720">` : `
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">`
  const media = videoUrl
    ? `<video controls autoplay muted loop playsinline preload="metadata" src="${safeVideoUrl}" aria-label="Shared Flash clip"></video>`
    : `<div class="empty" role="img" aria-label="Clip unavailable"><span>FLASH</span></div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle} — Flash</title>
<meta name="theme-color" content="#0a0a0b">
<meta name="robots" content="noindex">
<meta property="og:title" content="${safeTitle} — Flash">
<meta property="og:image" content="${SITE_ORIGIN}/og.jpg">
<meta property="og:url" content="${safeCanonicalUrl}">${videoMeta}
<meta name="twitter:title" content="${safeTitle} — Flash">
<meta name="twitter:image" content="${SITE_ORIGIN}/og.jpg">
<link rel="canonical" href="${safeCanonicalUrl}">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Antonio:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ground:#0a0a0b; --panel:#121316; --edge:#2a2d34; --bone:#f2f3f5; --ash:#9aa0ab; --hairline:rgba(242,243,245,.3); --glass:rgba(242,243,245,.07); --display:'Antonio','Bahnschrift SemiCondensed','Arial Narrow',sans-serif; --ui:'Segoe UI Variable Text','Segoe UI',system-ui,'Noto Sans',Cantarell,Ubuntu,sans-serif; }
  * { box-sizing:border-box; margin:0; }
  html { background:var(--ground); color:var(--bone); font-family:var(--ui); -webkit-font-smoothing:antialiased; }
  body { min-height:100vh; background:var(--ground); }
  a { color:inherit; text-decoration:none; }
  .shell { width:min(1120px,calc(100% - 96px)); margin:0 auto; padding:22px 0 48px; }
  nav { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:42px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { width:34px; height:34px; border-radius:9px; }
  .brand span { font:600 26px/1 var(--display); letter-spacing:.02em; }
  .btn { display:inline-flex; align-items:center; justify-content:center; min-height:46px; padding:0 24px; border:1px solid var(--bone); border-radius:6px; background:var(--bone); color:var(--ground); font:600 11px/1 var(--ui); letter-spacing:.14em; text-transform:uppercase; transition:background .15s,border-color .15s; }
  .btn:hover { background:#fff; border-color:#fff; }
  .btn:focus-visible { outline:2px solid var(--bone); outline-offset:4px; }
  .frame { overflow:hidden; aspect-ratio:16/9; border:1px solid var(--edge); border-radius:12px; background:#000; }
  video { display:block; width:100%; height:100%; object-fit:contain; background:#000; }
  .empty { display:grid; place-items:center; width:100%; height:100%; background:var(--panel); color:var(--edge); font:600 clamp(70px,16vw,190px)/1 var(--display); letter-spacing:.02em; user-select:none; }
  .copy { padding-top:18px; }
  .meta { min-height:18px; color:var(--ash); font-size:12px; font-variant-numeric:tabular-nums; }
  .caption { margin-top:8px; font:600 clamp(28px,4vw,42px)/1 var(--display); text-transform:uppercase; }
  @media (max-width:700px) { .shell { width:calc(100% - 40px); padding-top:18px; } nav { margin-bottom:28px; } .btn { min-height:42px; padding:0 16px; } .frame { border-radius:8px; } }
  @media (max-width:420px) { .brand span { display:none; } .shell { width:calc(100% - 32px); } }
</style>
</head>
<body>
<main class="shell">
  <nav>
    <a class="brand" href="/" aria-label="Flash home"><img src="/logo.png" alt=""><span>FLASH</span></a>
    <a class="btn" id="download" href="${WINDOWS_FALLBACK}">Download for Windows</a>
  </nav>
  <div class="frame">${media}</div>
  <div class="copy"><div class="meta">${safeMeta}</div><p class="caption">${safeCaption}</p></div>
</main>
<script>
(function () {
  var releasesUrl = ${JSON.stringify(RELEASES_URL)};
  var windowsFallback = ${JSON.stringify(WINDOWS_FALLBACK)};
  var linuxFallback = ${JSON.stringify(LINUX_FALLBACK)};
  var ua = navigator.userAgent || '';
  var phone = /Android|iPhone|iPad|iPod/i.test(ua);
  var linux = !phone && /Linux|X11/i.test(ua) && !/Windows/i.test(ua);
  var button = document.getElementById('download');
  button.href = phone ? '/#get' : (linux ? linuxFallback : windowsFallback);
  button.textContent = phone ? 'Get Flash' : (linux ? 'Download for Linux' : 'Download for Windows');
  if (phone) return;
  fetch(releasesUrl, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (response) { return response.ok ? response.json() : Promise.reject(); })
    .then(function (releases) {
      var release = releases.filter(function (item) { return !item.draft; })[0];
      if (!release) return;
      var asset = release.assets.filter(function (item) { return linux ? /\\.AppImage$/i.test(item.name) : /Setup.*\\.exe$/i.test(item.name); })[0];
      if (asset) button.href = asset.browser_download_url;
    }).catch(function () {});
})();
</script>
</body>
</html>`
}

function htmlResponse(html, status, method, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex',
    ...extraHeaders,
  })
  return new Response(method === 'HEAD' ? null : html, { status, headers })
}

function notFound(method) {
  return new Response(method === 'HEAD' ? null : 'Not found', { status: 404 })
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return notFound(method)

    const match = /^\/c\/([^/]+?)(\.mp4)?$/.exec(url.pathname)
    if (!match || !CLIP_ID.test(match[1])) return notFound(method)

    const id = match[1]
    const videoUrl = `${SHARE_ORIGIN}/c/${id}.mp4`
    if (match[2]) return Response.redirect(videoUrl, 302)

    const canonicalUrl = `${SITE_ORIGIN}/c/${id}`
    let clipResponse
    try {
      clipResponse = await fetch(videoUrl, { method: 'HEAD' })
    } catch {
      const html = pageTemplate({ title: 'Clip unavailable', meta: 'Can’t load this clip right now.', caption: 'Never miss the clip.', canonicalUrl })
      return htmlResponse(html, 503, method, { 'Cache-Control': 'no-store' })
    }

    if (clipResponse.status === 200) {
      const expiry = expiryText(clipResponse.headers.get('Last-Modified'))
      const meta = expiry ? `Shared clip · ${expiry}` : 'Shared clip'
      const html = pageTemplate({ title: 'Shared clip', meta, caption: 'Never miss the clip.', videoUrl, canonicalUrl })
      return htmlResponse(html, 200, method)
    }

    if (clipResponse.status === 404) {
      const html = pageTemplate({ title: 'Clip gone', meta: 'This clip has expired.', caption: 'Never miss the clip.', canonicalUrl })
      return htmlResponse(html, 410, method)
    }

    const html = pageTemplate({ title: 'Clip unavailable', meta: 'Can’t load this clip right now.', caption: 'Never miss the clip.', canonicalUrl })
    return htmlResponse(html, 503, method, { 'Cache-Control': 'no-store' })
  },
}
