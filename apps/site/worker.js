const SHARE_ORIGIN = 'https://share.flashclipping.fyi'
const SITE_ORIGIN = 'https://flashclipping.fyi'
const RELEASES_URL = 'https://api.github.com/repos/flash-labs-dev/flash/releases?per_page=5'
const WINDOWS_FALLBACK = 'https://github.com/flash-labs-dev/flash/releases/download/v0.1.0-beta.5/Flash-Setup-0.1.0-beta.5.exe'
const LINUX_FALLBACK = 'https://github.com/flash-labs-dev/flash/releases/download/v0.1.0-beta.5/Flash-0.1.0-beta.5.AppImage'
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

function pageTemplate({ title, meta, expiry = '', videoUrl = '', saveUrl = '', canonicalUrl = '', clipId = '' }) {
  const safeTitle = escapeHtml(title)
  const safeMeta = escapeHtml(meta)
  const safeExpiry = escapeHtml(expiry)
  const safeVideoUrl = escapeHtml(videoUrl)
  const safeSaveUrl = escapeHtml(saveUrl)
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
    ? `<video id="clip" controls autoplay muted loop playsinline preload="metadata" src="${safeVideoUrl}" aria-label="Shared Flash clip"></video><button class="unmute" id="unmute" type="button">Tap for sound</button>`
    : `<div class="empty" role="img" aria-label="Clip unavailable"><span>FLASH</span></div>`
  const details = videoUrl
    ? `<div class="under">
        <div class="who"><h1 class="title">${safeTitle}</h1>${expiry ? `<div class="pills"><span class="pill"><i></i>${safeExpiry}</span></div>` : ''}</div>
        <div class="acts"><button class="btn" id="copy" type="button">Copy link</button><a class="btn" href="${safeSaveUrl}">Save clip</a></div>
      </div>`
    : `<div class="under state"><div class="who"><h1 class="title">${safeTitle}</h1><p class="state-message">${safeMeta}</p></div></div>`
  const interactive = videoUrl
    ? `<div class="toast" id="toast" role="status" aria-live="polite">Link copied</div>`
    : ''
  const launchCard = videoUrl && CLIP_ID.test(clipId)
    ? `<div class="launch" id="launch" role="dialog" aria-modal="true" aria-labelledby="launch-title" hidden>
  <div class="lcard">
    <img src="/logo.png" alt="">
    <h2 id="launch-title">Opening in Flashâ€¦</h2>
    <p>Launching your Flash app to watch this clip. Feel free to close this tab, or keep watching here.</p>
    <div class="lbar" aria-hidden="true"><i></i></div>
    <label class="lchk"><input id="launch-browser" type="checkbox"> Always watch in browser</label>
    <button class="wbtn" id="launch-watch" type="button">Watch here</button>
  </div>
</div>`
    : ''

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
  :root { --ground:#0a0a0b; --panel:#121316; --edge:#2a2d34; --bone:#f2f3f5; --ash:#9aa0ab; --live:#4ade80; --hairline:rgba(242,243,245,.3); --glass:rgba(242,243,245,.07); --display:'Antonio','Bahnschrift SemiCondensed','Arial Narrow',sans-serif; --ui:'Segoe UI Variable Text','Segoe UI',system-ui,'Noto Sans',Cantarell,Ubuntu,sans-serif; }
  * { box-sizing:border-box; margin:0; }
  html { background:var(--ground); color:var(--bone); font-family:var(--ui); -webkit-font-smoothing:antialiased; }
  body { min-height:100vh; overflow-x:hidden; position:relative; background:var(--ground); }
  a { color:inherit; text-decoration:none; }
  .glow { position:fixed; inset:-10%; z-index:0; overflow:hidden; filter:blur(90px) saturate(1.4); opacity:.45; pointer-events:none; }
  .glow video { width:100%; height:100%; object-fit:cover; }
  .glow::after { content:""; position:absolute; inset:0; background:radial-gradient(ellipse at 50% 40%,transparent 0,var(--ground) 80%); }
  .shell { position:relative; z-index:1; width:min(1560px,calc(100% - 56px)); margin:0 auto; padding:22px 0 56px; }
  nav { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:34px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { width:34px; height:34px; border-radius:9px; }
  .brand span { font:600 26px/1 var(--display); letter-spacing:.02em; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:46px; padding:0 24px; border:1px solid var(--hairline); border-radius:6px; background:transparent; color:var(--bone); font:600 11px/1 var(--ui); letter-spacing:.14em; text-transform:uppercase; cursor:pointer; transition:background .15s,border-color .15s; }
  .btn:hover { background:var(--glass); border-color:rgba(242,243,245,.7); }
  .btn.solid { background:var(--bone); color:var(--ground); border-color:var(--bone); }
  .btn.solid:hover { background:#fff; }
  .btn:focus-visible,.brand:focus-visible,.unmute:focus-visible { outline:2px solid var(--bone); outline-offset:4px; }
  .btn svg { width:16px; height:16px; fill:currentColor; }
  .main { display:grid; grid-template-columns:1fr; gap:24px; align-items:start; }
  .player,.under,.side { width:min(100%,calc((100vh - 190px) * 16 / 9)); margin-inline:auto; }
  .player { position:relative; overflow:hidden; aspect-ratio:16/9; max-height:calc(100vh - 190px); border:1px solid var(--edge); border-radius:14px; background:#000; box-shadow:0 40px 120px rgba(0,0,0,.6); }
  .player > video { display:block; width:100%; height:100%; object-fit:contain; background:#000; }
  .empty { display:grid; place-items:center; width:100%; height:100%; background:var(--panel); color:var(--edge); font:600 clamp(70px,16vw,190px)/1 var(--display); letter-spacing:.02em; user-select:none; }
  .unmute { position:absolute; left:16px; bottom:16px; z-index:3; display:flex; align-items:center; gap:8px; height:38px; padding:0 14px; border:1px solid var(--edge); border-radius:999px; background:rgba(10,10,11,.75); color:var(--bone); font:600 11px/1 var(--ui); letter-spacing:.12em; text-transform:uppercase; backdrop-filter:blur(8px); cursor:pointer; }
  .unmute.hide { display:none; }
  .under { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-top:18px; }
  .who { display:flex; flex-direction:column; gap:8px; min-width:0; }
  .title { font:600 clamp(30px,4vw,46px)/.95 var(--display); text-transform:uppercase; }
  .pills { display:flex; gap:8px; flex-wrap:wrap; }
  .pill { display:inline-flex; align-items:center; gap:7px; height:26px; padding:0 11px; border:1px solid var(--edge); border-radius:999px; background:rgba(10,10,11,.5); color:var(--ash); font:600 10px/1 var(--ui); letter-spacing:.12em; text-transform:uppercase; }
  .pill i { width:6px; height:6px; border-radius:50%; background:var(--live); }
  .state-message { color:var(--ash); font-size:14px; }
  .acts { display:flex; gap:10px; }
  .toast { position:fixed; left:50%; bottom:28px; z-index:9; transform:translate(-50%,20px); opacity:0; padding:12px 18px; border-radius:8px; background:var(--bone); color:var(--ground); font:600 11px/1 var(--ui); letter-spacing:.14em; text-transform:uppercase; transition:opacity .25s,transform .25s; pointer-events:none; }
  .toast.on { opacity:1; transform:translate(-50%,0); }
  .side { display:flex; flex-direction:row; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; padding:20px 26px; border:1px solid var(--edge); border-radius:14px; background:rgba(18,19,22,.85); backdrop-filter:blur(10px); }
  .pitch { display:flex; align-items:center; gap:20px; }
  .side h2 { font:600 40px/.9 var(--display); text-transform:uppercase; }
  .keycap { display:grid; place-items:center; flex:0 0 auto; width:64px; height:64px; border:1px solid #3a3e47; border-radius:14px; background:linear-gradient(#2c2f36,#1a1c21); box-shadow:0 8px 0 #0c0d10,0 20px 40px rgba(0,0,0,.5); font:600 30px/1 var(--display); animation:press 3.2s ease-in-out infinite; }
  @keyframes press { 0%,60%,100% { transform:none; } 66%,76% { transform:translateY(7px); box-shadow:0 1px 0 #0c0d10,0 10px 26px rgba(0,0,0,.5); } }
  .side ul { display:flex; gap:22px; list-style:none; padding:0; color:var(--ash); font-size:14px; }
  .side li::before { content:"✓"; margin-right:10px; color:var(--bone); font-weight:700; }
  .side .btn { padding:0 32px; }
  @media (max-width:760px) { .shell { width:calc(100% - 32px); padding-top:18px; } nav { margin-bottom:28px; } .player,.under,.side { width:100%; } .side { flex-direction:column; align-items:stretch; } .side ul { flex-direction:column; gap:8px; width:100%; } .side .btn { width:100%; } }
  @media (max-width:560px) { nav .btn { display:none; } .acts { width:100%; } .acts .btn { flex:1; padding-inline:12px; } }
  @media (prefers-reduced-motion:reduce) { .keycap { animation:none; } .glow { display:none; } .toast { transition:none; } }
  .launch { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:rgba(10,10,11,.72); backdrop-filter:blur(6px); }
  .launch[hidden] { display:none; }
  .lcard { width:min(400px,calc(100% - 40px)); padding:34px 30px 26px; border-radius:14px; background:#121316; border:1px solid #2a2d34; box-shadow:0 40px 120px rgba(0,0,0,.7); text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; color:#f2f3f5; }
  .lcard img { width:56px; height:56px; border-radius:14px; }
  .lcard h2 { font:600 34px/1 var(--display); text-transform:uppercase; letter-spacing:.02em; margin:0; }
  .lcard p { color:#9aa0ab; font-size:14px; line-height:1.5; margin:0; }
  .lbar { width:100%; height:3px; border-radius:3px; background:#202228; overflow:hidden; }
  .lbar i { display:block; height:100%; width:40%; background:#f2f3f5; animation:launch-slide 1.4s ease-in-out infinite; }
  @keyframes launch-slide { 0% { transform:translateX(-100%); } 100% { transform:translateX(250%); } }
  .lchk { display:flex; align-items:center; gap:10px; color:#f2f3f5; font-size:13px; cursor:pointer; }
  .lchk input { accent-color:#f2f3f5; width:16px; height:16px; }
  .lcard .wbtn { width:100%; margin-top:4px; padding:12px; border-radius:8px; border:1px solid #2a2d34; background:#f2f3f5; color:#0a0a0b; font-weight:600; font-size:14px; cursor:pointer; }
  .wbtn:focus-visible,.lchk input:focus-visible { outline:2px solid var(--bone); outline-offset:4px; }
  @media (prefers-reduced-motion:reduce) { .lbar i { animation:none; width:100%; } }
</style>
</head>
<body>
<main class="shell">
  <nav>
    <a class="brand" href="/" aria-label="Flash home"><img src="/logo.png" alt=""><span>FLASH</span></a>
    <a class="btn solid download-link" href="${WINDOWS_FALLBACK}"><span class="download-label">Download for Windows</span></a>
  </nav>
  <div class="main">
    <div><div class="player">${media}</div>${details}</div>
    <aside class="side">
      <div class="pitch"><div class="keycap">F8</div><h2>Clip your<br>own.</h2></div>
      <ul><li>Free, no account</li><li>Always recording</li><li>Windows and Linux</li></ul>
      <a class="btn solid download-link" href="${WINDOWS_FALLBACK}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v11.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM5 20h14v2H5z"/></svg><span class="download-label">Download for Windows</span></a>
    </aside>
  </div>
</main>
${interactive}
${launchCard}
<script>
(function () {
  var releasesUrl = ${JSON.stringify(RELEASES_URL)};
  var windowsFallback = ${JSON.stringify(WINDOWS_FALLBACK)};
  var linuxFallback = ${JSON.stringify(LINUX_FALLBACK)};
  var ua = navigator.userAgent || '';
  var phone = /Android|iPhone|iPad|iPod/i.test(ua);
  var linux = !phone && /Linux|X11/i.test(ua) && !/Windows/i.test(ua);
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.download-link'));
  var label = phone ? 'Get Flash' : (linux ? 'Download for Linux' : 'Download for Windows');
  var fallback = phone ? '/#get' : (linux ? linuxFallback : windowsFallback);
  buttons.forEach(function (button) {
    button.href = fallback;
    button.querySelector('.download-label').textContent = label;
  });

  if (!phone) {
    fetch(releasesUrl, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (response) { return response.ok ? response.json() : Promise.reject(); })
      .then(function (releases) {
        var release = releases.filter(function (item) { return !item.draft; })[0];
        if (!release) return;
        var asset = release.assets.filter(function (item) { return linux ? /\\.AppImage$/i.test(item.name) : /Setup.*\\.exe$/i.test(item.name); })[0];
        if (asset) buttons.forEach(function (button) { button.href = asset.browser_download_url; });
      }).catch(function () {});
  }

  var video = document.getElementById('clip');
  var unmute = document.getElementById('unmute');
  if (video && unmute) {
    unmute.addEventListener('click', function () { video.muted = false; video.play().catch(function () {}); unmute.classList.add('hide'); });
    video.addEventListener('volumechange', function () { if (!video.muted) unmute.classList.add('hide'); });
  }

  var copy = document.getElementById('copy');
  var toast = document.getElementById('toast');
  if (copy && toast) copy.addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(location.href); } catch (error) { return; }
    toast.classList.add('on');
    setTimeout(function () { toast.classList.remove('on'); }, 1600);
  });

  try {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (video && !reduced && !phone && window.innerWidth >= 700) {
      var glow = document.createElement('div');
      var glowVideo = document.createElement('video');
      glow.className = 'glow';
      glow.setAttribute('aria-hidden', 'true');
      glowVideo.src = video.currentSrc || video.src;
      glowVideo.autoplay = true;
      glowVideo.muted = true;
      glowVideo.loop = true;
      glowVideo.playsInline = true;
      glow.appendChild(glowVideo);
      document.body.insertBefore(glow, document.body.firstChild);
      glowVideo.play().catch(function () {});
    }
  } catch (error) {}

  var launch = document.getElementById('launch');
  var launchWatch = document.getElementById('launch-watch');
  var launchBrowser = document.getElementById('launch-browser');
  var launchMobile = (window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches)) || /Android|iPhone|iPad|Mobile/i.test(ua);
  var browserOnly = false;
  try { browserOnly = localStorage.getItem('flashWatchInBrowser') === '1'; } catch (error) {}
  if (launch && launchWatch && launchBrowser && !launchMobile && !browserOnly) {
    var dismissLaunch = function () { launch.hidden = true; };
    launch.hidden = false;
    launchWatch.focus();
    launchWatch.addEventListener('click', dismissLaunch);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') dismissLaunch(); });
    launchBrowser.addEventListener('change', function () {
      try {
        if (launchBrowser.checked) localStorage.setItem('flashWatchInBrowser', '1');
        else localStorage.removeItem('flashWatchInBrowser');
      } catch (error) {}
    });
    var launcher = document.createElement('iframe');
    launcher.hidden = true;
    launcher.setAttribute('aria-hidden', 'true');
    launcher.src = ${JSON.stringify(clipId ? `flash://c/${clipId}` : '')};
    document.body.appendChild(launcher);
    setTimeout(dismissLaunch, 5000);
  }
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
      const html = pageTemplate({ title: 'Clip unavailable', meta: 'Can’t load this clip right now.', canonicalUrl })
      return htmlResponse(html, 503, method, { 'Cache-Control': 'no-store' })
    }

    if (clipResponse.status === 200) {
      const expiry = expiryText(clipResponse.headers.get('Last-Modified'))
      const saveUrl = `/c/${id}.mp4`
      const html = pageTemplate({ title: 'Shared clip', meta: 'Shared clip', expiry, videoUrl, saveUrl, canonicalUrl, clipId: id })
      return htmlResponse(html, 200, method)
    }

    if (clipResponse.status === 404) {
      const html = pageTemplate({ title: 'Clip gone', meta: 'This clip has expired.', canonicalUrl })
      return htmlResponse(html, 410, method)
    }

    const html = pageTemplate({ title: 'Clip unavailable', meta: 'Can’t load this clip right now.', canonicalUrl })
    return htmlResponse(html, 503, method, { 'Cache-Control': 'no-store' })
  },
}
