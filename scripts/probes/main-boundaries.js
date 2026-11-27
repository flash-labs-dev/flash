// Runs actual main-process functions with isolated services and temporary files.
// No app startup, screen capture, hotkey registration or user settings are used.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { EventEmitter } = require('node:events')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')
const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
function functions(names, context) {
  const selected = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  assert.equal(selected.length, names.length)
  runInNewContext(ts.transpileModule(selected.map(node => node.getText(tree)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  return context
}

;(async () => {
  const { byteRange } = await import('../../apps/desktop/src/shared/byteRange.ts')
  const { clipPathFromUrl } = await import('../../apps/desktop/src/shared/platform.ts')
  const { clipUrl } = await import('../../apps/desktop/src/shared/editor.ts')
  const { isInsideRoot, samePath } = await import('../../apps/desktop/src/shared/clipsRoot.ts')
  const { writeSidecar, readSidecar, invalidateSidecarCache } = await import('../../apps/desktop/src/shared/clipFiles.ts')
  const { clipMarkOffsets, transferClipMarks } = await import('../../apps/desktop/src/shared/clipMarks.ts')
  const { gameFolderName, firstFreeName, clipTimestamp } = await import('../../apps/desktop/src/shared/clipPath.ts')
  const { cornerBounds, toastHtml, overlayHtml } = await import('../../apps/desktop/src/shared/windowTemplates.ts')
  const { saveError } = await import('../../apps/desktop/src/shared/saveError.ts')
  const { publishScreenshot } = await import('../../apps/desktop/src/shared/publishScreenshot.ts')
  const { selectCaptureDisplay } = await import('../../apps/desktop/src/shared/displaySelection.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-boundaries-'))
  const messages = []
  const context = {
    console: { ...console, warn() {}, error: (...a) => process.stderr.write('ERR ' + a.map(String).join(' ') + '\n') }, process, ...fs, ...path, Blob, Response,
    settings: { clipsFolder: dir, notifications: true, overlay: true, overlayPosition: 'bottom-right', theme: 'blood', displayId: 99 },
    activeClipsFolder: () => dir, activeDisplayId: () => 99, sessionDisplayId: null, selectCaptureDisplay,
    currentGame: 'Game A', isRecording: true, nativeSaveInFlight: null, CLIP_SAVE_TIMEOUT_MS: 120_000, setTimeout, clearTimeout, writeSidecar, readSidecar, clipMarkOffsets, transferClipMarks, markTimesMs: [], gameFolderName, firstFreeName, clipTimestamp,
    mainWindow: { webContents: { send: (...args) => messages.push(args) }, isVisible: () => false, isMinimized: () => false },
    captureAddon: {
      getStatus: () => ({ recording: true }),
      saveScreenshot: async file => fs.writeFileSync(file, 'PNG fixture'),
      saveClip: async () => ({ path: path.join(dir, 'Game B', 'clip.mp4'), duration: 4, game: 'Game B' }),
      listDisplays: () => [{ id: 2, isPrimary: true }],
    },
    clipboard: { write: async () => { throw new Error('injected clipboard rejection') } },
    ClipboardItem: class { constructor(data) { this.data = data } },
    playClipSound() {}, showClipNotification() {}, updateOverlay() {}, setRecordingState() {}, publishScreenshot,
    trackOutputJob: job => job,
    checkDiskSpace: async () => { context.currentGame = 'Game B'; return null },
  }
  try {
    const recordingState = { isRecording: true, autoStopped: false,
      markTimesMs: [10_000], lastMarkPressMs: 10_000,
      updateTrayMenu() {}, updateOverlay() {}, mainWindow: { webContents: { send() {} } } }
    functions(['setRecordingState'], recordingState)
    recordingState.setRecordingState(false)
    assert.deepEqual(Array.from(recordingState.markTimesMs), [])
    assert.equal(recordingState.lastMarkPressMs, -Infinity)
    console.log('PASS: stopping capture clears marks and mark-key debounce for the next recording')

    const existingDiskCheck = context.checkDiskSpace
    Object.assign(context, { saveError, MIN_FREE_BYTES: 2 * 1024 ** 3,
      statfs: async () => ({ bavail: 3 * 1024 ** 3, bsize: 1 }) })
    functions(['checkDiskSpace'], context)
    assert.equal(await context.checkDiskSpace(), null)
    for (const code of ['ENOENT', 'ENODEV']) {
      context.statfs = async () => { throw Object.assign(new Error('statfs failed'), { code }) }
      assert.match(await context.checkDiskSpace(), /clips folder or drive is unavailable/)
    }
    context.statfs = async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOSYS' }) }
    assert.equal(await context.checkDiskSpace(), null)
    context.checkDiskSpace = existingDiskCheck
    console.log('PASS: disk check reports missing folders and drives through the save error path')

    const editorSource = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/renderer/Editor.tsx'), 'utf8')
    const editorTree = ts.createSourceFile('Editor.tsx', editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const callbacks = []
    function findEditorCallbacks(node) {
      if (ts.isVariableDeclaration(node) && ['queueTrimWrite', 'closeEditor'].includes(node.name.getText(editorTree))) callbacks.push(node.getText(editorTree))
      ts.forEachChild(node, findEditorCallbacks)
    }
    findEditorCallbacks(editorTree)
    assert.equal(callbacks.length, 2)
    function editorHarness(setClipTrim) {
      const notes = [], closed = []
      const editor = { useCallback: fn => fn, videoRef: { current: { duration: 10 } }, duration: 10,
        trimWrite: { current: Promise.resolve() }, trimWriteFailed: { current: false },
        window: { flash: { setClipTrim } }, clip: { filePath: 'clip.mp4' },
        setSaveNote: note => notes.push(note), draggingEdit: { current: false },
        endDrag() {}, saving: false, onClose: () => closed.push(true) }
      const code = ts.transpileModule(`const ${callbacks.join('; const ')}; globalThis.editorCallbacks = { queueTrimWrite, closeEditor }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
      }).outputText
      runInNewContext(code, editor)
      return { ...editor.editorCallbacks, notes, closed }
    }
    const trim = { inSec: 1, outSec: 9 }
    const successful = editorHarness(async () => ({}))
    successful.queueTrimWrite(trim)
    await successful.closeEditor()
    assert.equal(successful.closed.length, 1)
    const failed = editorHarness(async () => ({ error: 'drive gone' }))
    failed.queueTrimWrite(trim)
    await failed.closeEditor()
    assert.equal(failed.closed.length, 0)
    assert.match(failed.notes.at(-1), /Could not save trim: drive gone/)
    await failed.closeEditor()
    assert.equal(failed.closed.length, 1)
    const rejected = editorHarness(async () => { throw new Error('write failed') })
    rejected.queueTrimWrite(trim)
    await rejected.closeEditor()
    assert.equal(rejected.closed.length, 0)
    assert.match(rejected.notes.at(-1), /Could not save trim/)
    await rejected.closeEditor()
    assert.equal(rejected.closed.length, 1)
    console.log('PASS: failed final trim stays visible; a second Back or Escape closes the editor')

    functions(['runSaveScreenshot', 'runSaveClip', 'onClipSaved', 'writeDerivedClipSidecar', 'availableDisplay', 'playbackVisible'], context)
    await context.runSaveScreenshot()
    assert.equal(fs.readdirSync(path.join(dir, 'Game A')).filter(name => name.endsWith('.png')).length, 1)
    assert.equal(messages.some(([channel]) => channel === 'clip-saved-refresh'), true)
    assert.match(messages.find(([channel]) => channel === 'clip-save-state')[1].error, /saved to library/)
    fs.mkdirSync(path.join(dir, 'Game B'))
    const saved = await context.runSaveClip()
    assert.equal(readSidecar(saved.path).game, 'Game B')
    assert.equal(path.basename(path.dirname(saved.path)), 'Game B')
    let finishSave
    context.captureAddon.saveClip = () => new Promise(resolve => { finishSave = resolve })
    context.markTimesMs = [Date.now() - 1000]
    const pendingSave = context.runSaveClip()
    await new Promise(resolve => setImmediate(resolve))
    // A new mark while muxing may prune the live list, but not this save's snapshot.
    context.markTimesMs = [Date.now()]
    finishSave({ path: saved.path, duration: 4, game: 'Game B' })
    await pendingSave
    const savedMarks = readSidecar(saved.path).marksSec
    assert.equal(savedMarks.length, 1)
    assert.ok(savedMarks[0] > 2.9 && savedMarks[0] < 3.1)
    writeSidecar(saved.path, { duration: 15, game: 'Game B', marksSec: [14.2] })
    const derived = path.join(dir, 'Game B', 'derived.mp4')
    context.writeDerivedClipSidecar(saved.path, derived, 9.49, 5)
    assert.deepEqual(readSidecar(derived), { duration: 9.49, game: 'Game B', marksSec: [9.2] })
    assert.equal(context.availableDisplay(99), 2)
    assert.equal(context.availableDisplay(2), 2)
    assert.equal(context.playbackVisible(), false)
    context.mainWindow.isVisible = () => true
    context.mainWindow.isMinimized = () => true
    assert.equal(context.playbackVisible(), false)
    context.mainWindow.isMinimized = () => false
    assert.equal(context.playbackVisible(), true)
    console.log('PASS: clipboard rejection refreshes saved PNG; save snapshots marks before muxing; derived sidecar keeps fractional duration; game identity and display fallback')

    // The native worker may never settle. Release the UI queue on timeout, but
    // do not start another writer until it really settles.
    const saveNames = new Set(['saveInFlight', 'saveInFlightSeconds', 'nativeSaveInFlight', 'CLIP_SAVE_TIMEOUT_MS'])
    const saveDeclarations = tree.statements.filter(node => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(declaration => saveNames.has(declaration.name.getText(tree))))
    const saveFunctions = tree.statements.filter(node => ts.isFunctionDeclaration(node) &&
      ['showSaveError', 'saveClipNow', 'runSaveClip', 'onClipSaved'].includes(node.name?.text))
    const saveTimers = [], saveMessages = [], notices = []
    const latePath = path.join(dir, 'Game B', 'late.mp4')
    fs.writeFileSync(latePath, 'late clip fixture')
    let finishNative, nativeCalls = 0
    const saveContext = {
      ...context, console: { ...console, error() {} }, saveError, setTimeout: callback => { saveTimers.push(callback); return saveTimers.length },
      clearTimeout() {}, Notification: class { constructor(info) { this.info = info } show() { notices.push(this.info) } },
      mainWindow: { webContents: { send: (...args) => saveMessages.push(args) }, isFocused: () => false },
      captureAddon: { getStatus: () => ({ recording: true }), saveClip: () => {
        nativeCalls++
        return nativeCalls === 1 ? new Promise(resolve => { finishNative = resolve })
          : Promise.resolve({ path: saved.path, duration: 4, game: 'Game B' })
      } },
      checkDiskSpace: async () => null, markTimesMs: [], pruneStorage() {},
      showClipNotification() {}, playClipSound() {}, updateOverlay() {},
    }
    runInNewContext(ts.transpileModule([...saveDeclarations, ...saveFunctions].map(node => node.getText(tree)).join('\n') +
      '\nglobalThis.saveClipNow = saveClipNow', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, saveContext)
    const hung = saveContext.saveClipNow()
    const queued = saveContext.saveClipNow(5)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(nativeCalls, 1)
    assert.equal(saveTimers.length, 1, 'native save needs a timeout')
    saveTimers[0]()
    assert.match((await hung).error, /timed out/i)
    assert.match((await queued).error, /still writing/i)
    assert.equal(nativeCalls, 1)
    assert.match((await saveContext.saveClipNow()).error, /still writing/i)
    assert.equal(nativeCalls, 1)
    assert.equal(notices.length >= 1, true)
    assert.equal(saveMessages.some(([channel, state]) => channel === 'clip-save-state' && /timed out/i.test(state.error ?? '')), true)
    const refreshes = saveMessages.filter(([channel]) => channel === 'clip-saved-refresh').length
    finishNative({ path: latePath, duration: 4, game: 'Game B' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(saveMessages.filter(([channel]) => channel === 'clip-saved-refresh').length, refreshes + 1)
    assert.equal(readSidecar(latePath).game, 'Game B')
    assert.equal((await saveContext.saveClipNow()).path, saved.path)
    assert.equal(nativeCalls, 2)
    console.log('PASS: hung native save times out visibly, blocks concurrent writers, records a late result, and recovers')

    let handler
    Object.assign(context, { byteRange, clipPathFromUrl, isInsideRoot, Readable: require('node:stream').Readable,
      protocol: { handle: (_scheme, callback) => { handler = callback } },
      isInsideClips: file => file.startsWith(dir), resource: () => path.join(dir, 'sound.wav'),
    })
    functions(['registerClipProtocol'], context)
    context.registerClipProtocol()
    const media = path.join(dir, 'range ü.mp4')
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
    fs.writeFileSync(media, bytes)
    // The renderer's own URL builder, so the probe follows it on every platform:
    // a POSIX path has no drive letter and keeps its slashes.
    const url = clipUrl(media)
    for (const [range, status, start, end] of [[null, 200, 0, 1000], ['bytes=100-', 206, 100, 1000], ['bytes=-100', 206, 900, 1000], ['bytes=200-299', 206, 200, 300]]) {
      const response = await handler({ url, headers: new Headers(range ? { Range: range } : {}) })
      assert.equal(response.status, status)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end))
    }
    for (const range of ['bytes=-0', 'bytes=1000-', 'bytes=2-1', 'bytes=1-2,4-5', 'broken']) {
      const response = await handler({ url, headers: new Headers({ Range: range }) })
      assert.equal(response.status, 416)
      assert.equal(response.headers.get('Content-Range'), 'bytes */1000')
    }
    fs.writeFileSync(media, '')
    const empty = await handler({ url, headers: new Headers() })
    assert.equal(empty.status, 200)
    assert.equal((await empty.arrayBuffer()).byteLength, 0)
    console.log('PASS: actual protocol returns byte-exact full/open/suffix/explicit responses, Unicode paths, empty 200 and invalid 416')

    const timers = []
    const windows = []
    class FakeWindow extends EventEmitter {
      constructor() { super(); this.webContents = { executeJavaScript: script => { this.script = script; return Promise.resolve() } }; windows.push(this) }
      isDestroyed() { return !!this.destroyed }
      close() { this.destroyed = true; this.emit('closed') }
      setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {} setBounds() {}
      showInactive() { this.shown = true }
      loadURL(url) { this.url = url }
    }
    Object.assign(context, { BrowserWindow: FakeWindow, notificationWindow: null, overlayWindow: null, overlaySaving: false,
      antonioFont: () => 'data:font/woff2;base64,fixture', toastHtml, overlayHtml, cornerBounds,
      captureDisplay: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }),
      setTimeout: callback => { timers.push(callback); return timers.length }, clearTimeout() {},
    })
    functions(['showClipNotification', 'createOverlay', 'overlayBounds', 'updateOverlay', 'destroyOverlay'], context)
    context.showClipNotification(3)
    const first = windows.at(-1)
    first.emit('ready-to-show')
    context.showClipNotification(5)
    const second = windows.at(-1)
    second.emit('ready-to-show')
    timers[0]()
    assert.equal(second.isDestroyed(), false)
    assert.equal(second.shown, true)
    context.updateOverlay(true)
    const overlay = windows.at(-1)
    overlay.emit('ready-to-show')
    assert.match(overlay.script, /"saving":true/)
    context.updateOverlay()
    assert.match(overlay.script, /"saving":true/)
    context.updateOverlay(false)
    assert.match(overlay.script, /"saving":false/)
    let trayUpdates = 0, overlayUpdates = 0
    context.updateTrayMenu = () => trayUpdates++
    context.updateOverlay = () => overlayUpdates++
    functions(['setRecordingState'], context)
    context.setRecordingState(false); context.setRecordingState(true)
    assert.equal(trayUpdates, 2); assert.equal(overlayUpdates, 2)
    assert.deepEqual(messages.filter(([channel]) => channel === 'recording-state').map(([, value]) => value), [false, true])
    console.log('PASS: earlier toast timer cannot close its successor; overlay retains saving through readiness; recording surfaces agree')

    const registered = new Set()
    Object.assign(context, { hotkeyStatus: {}, hotkeyRegistered: false,
      globalShortcut: { unregisterAll: () => registered.clear(), register: key => {
        if (key === 'F10' || registered.has(key)) return false
        registered.add(key)
        return true
      } },
    })
    Object.assign(context.settings, { hotkey: 'F8', hotkeyShort: 'F8', screenshotHotkey: 'F10', markHotkey: '' })
    functions(['claim', 'registerHotkeys'], context)
    context.registerHotkeys()
    assert.deepEqual(context.hotkeyStatus, { clip: true, short: false, screenshot: false, mark: false })
    Object.assign(context.settings, { hotkeyShort: 'Shift+F8', screenshotHotkey: 'F9', markHotkey: 'F10' })
    context.registerHotkeys()
    assert.deepEqual(context.hotkeyStatus, { clip: true, short: true, screenshot: true, mark: false })
    context.settings.markHotkey = 'F11'
    context.registerHotkeys()
    assert.deepEqual(context.hotkeyStatus, { clip: true, short: true, screenshot: true, mark: true })
    console.log('PASS: duplicate and externally conflicted secondary hotkeys fail independently; rebinding refreshes all four')

    const shareCall = []
    function findShareHandler(node) {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' &&
          node.arguments[0]?.getText(tree) === "'share-clip-link'") shareCall.push(node.getText(tree))
      ts.forEachChild(node, findShareHandler)
    }
    findShareHandler(tree)
    assert.equal(shareCall.length, 1)
    const sharePath = path.join(dir, 'share.mp4')
    fs.writeFileSync(sharePath, 'clip fixture')
    let shareHandler, copiedLink = null, uploads = 0
    const shareContext = {
      ...context, setTimeout, clearTimeout, AbortController, AbortSignal, Date,
      process, randomUUID: () => 'fixture', tmpdir: () => dir,
      app: { getVersion: () => 'fixture' }, reusableShareUrl: () => null,
      ipcMain: { handle: (_name, handler) => { shareHandler = handler } },
      isInsideClips: file => file.startsWith(dir), existsSync: fs.existsSync, statSync: fs.statSync,
      extname: path.extname, markClipInUse() {}, releaseClipInUse() {},
      readSidecar: () => null, countMp4AudioTracks: async () => 1,
      shareExportMaxBytes: () => null, decideSharePreparation: () => 'original',
      checkShareSize: () => null, readFile: fs.promises.readFile,
      SHARE_UPLOAD_ENDPOINT: 'https://fixture.invalid', SHARE_DAYS: 7,
      shareUrlFromPath: () => 'https://flashclipping.fyi/c/AbC_-12345xY',
      net: { fetch: async () => {
        uploads++
        fs.unlinkSync(sharePath)
        return { status: 201, json: async () => ({ path: '/c/AbC_-12345xY.mp4' }) }
      } },
      clipboard: { writeText: value => { copiedLink = value } },
    }
    runInNewContext(ts.transpileModule(`let sharing = false; ${shareCall[0]}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, shareContext)
    const shared = await shareHandler(null, sharePath)
    assert.equal(uploads, 1)
    assert.equal(shared.ok, true, 'a completed upload must return its link even if the source disappeared')
    assert.equal(copiedLink, shared.url)
    console.log('PASS: completed upload returns its link when the source disappears')

    const { validateClipName, resolveClipFilename } = await import('../../apps/desktop/src/shared/rename.ts')
    const { migrateSidecars } = await import('../../apps/desktop/src/shared/clipFiles.ts')
    const { sidecarPath } = await import('../../apps/desktop/src/shared/clipPath.ts')
    const invalidated = []
    const trackInvalidation = file => { invalidated.push(file); invalidateSidecarCache(file) }
    const renameContext = { ...fs, ...path, console, validateClipName, resolveClipFilename,
      migrateSidecars, sidecarPath, invalidateSidecarCache: trackInvalidation, clipDeletion: { busy: () => false },
      isInsideClips: file => file.startsWith(dir) }
    functions(['renameClip'], renameContext)
    const caseFile = path.join(dir, 'Case.mp4')
    fs.writeFileSync(caseFile, 'media')
    writeSidecar(caseFile, { starred: true })
    const caseResult = renameContext.renameClip(caseFile, 'case')
    assert.equal(caseResult.error, undefined)
    assert.equal(invalidated.includes(caseFile), true)
    assert.equal(invalidated.includes(path.join(dir, 'case.mp4')), true)
    assert.equal(fs.readdirSync(dir).includes('case.mp4'), true, 'case-only rename must change the on-disk name')
    assert.equal(fs.readdirSync(dir).includes('case.mp4.json'), true)
    assert.equal(readSidecar(path.join(dir, 'case.mp4')).starred, true)
    console.log('PASS: case-only clip rename updates media and sidecar names')
    // Linux can hold both spellings; renaming one must never land on the other.
    const renamed = []
    Object.assign(renameContext, { readdirSync: () => ['Case.mp4', 'case.mp4'], existsSync: () => true,
      migrateSidecars: () => new Set(), renameSync: (from, to) => renamed.push(to) })
    renameContext.renameClip(caseFile, 'case')
    assert.equal(renamed.includes(path.join(dir, 'case.mp4')), false, 'rename must not overwrite a sibling that differs only in case')
    console.log('PASS: clip rename keeps a case-variant sibling')
    const moved = []
    const moveContext = { ...path, process: { platform: 'linux' }, validateClipName, resolveClipFilename, samePath,
      clipDeletion: { busy: () => false }, isInsideClips: () => true, existsSync: file => !file.endsWith('.json'),
      activeClipsFolder: () => dir, mkdirSync() {}, readdirSync: () => [], migrateSidecars: () => new Set(),
      sidecarPath, invalidateSidecarCache: trackInvalidation, readSidecar: () => null, writeSidecar() {}, markClipInUse() {}, releaseClipInUse() {},
      renameSync: (from, to) => moved.push([from, to]) }
    functions(['moveClipToGame'], moveContext)
    const moveSource = path.join(dir, 'Game', 'round.mp4')
    const moveResult = moveContext.moveClipToGame(moveSource, 'game')
    assert.equal(moveResult.error, undefined)
    assert.equal(invalidated.includes(moveSource), true)
    assert.equal(invalidated.includes(path.join(dir, 'game', 'round.mp4')), true)
    assert.equal(moved.length, 1, 'Linux case-variant game folders are distinct')
    console.log('PASS: move between Linux case-variant game folders')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
