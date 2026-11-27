// Exercises updater events, the install IPC gate, and the actual main-process
// game selection/settings functions without a packaged app or capture hardware.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const root = join(__dirname, '../../apps/desktop/src')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const updater = new EventEmitter()
let installs = 0
updater.quitAndInstall = () => { installs++ }
updater.checkForUpdates = async () => {}
const updateModule = { exports: {} }
runInNewContext(compile(readFileSync(join(root, 'main/updater.ts'), 'utf8')), {
  module: updateModule, exports: updateModule.exports,
  require: name => name === 'electron' ? { app: { isPackaged: true } } : { autoUpdater: updater },
  process: { env: {}, platform: 'win32' }, console,
  setTimeout: () => 1, setInterval: () => ({ unref() {} }),
})
const changes = []
updateModule.exports.startAutoUpdate(state => changes.push(state))
updater.emit('update-available', { version: '2.0.0' })
assert.equal(updateModule.exports.getUpdateState().status, 'downloading')
updater.emit('error', Error('download failed'))
assert.equal(updateModule.exports.getUpdateState().status, 'idle', 'failed download must clear the download state')
assert.equal(changes.at(-1).status, 'idle')
assert.equal(updateModule.exports.installUpdateNow(), false)
assert.equal(installs, 0)
updater.emit('update-downloaded', { version: '2.0.0' })
assert.equal(updateModule.exports.installUpdateNow(), true)
assert.equal(installs, 1)
updater.emit('error', Error('later check failed'))
assert.equal(updateModule.exports.getUpdateState().status, 'ready', 'a later check error must keep a downloaded update')

const mainSource = readFileSync(join(root, 'main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true)
const declarations = tree.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['detectKnownGame', 'detectCurrentGame', 'startGameDetection', 'applyCaptureSettings'].includes(node.name?.text))
assert.equal(declarations.length, 4)
const context = {
  console, process: { platform: 'win32' }, setInterval: callback => { context.poll = callback; return 1 },
  settings: { learnedGames: { 'arena.exe': 'My Arena' }, perGame: { 'My Arena': { bufferLength: 60, quality: '720p 30fps' } }, quality: '1080p 60fps', bufferLength: 30 },
  GAME_DB: { 'arena.exe': 'Bundled Arena' }, currentGame: null, currentGamePid: 0,
  learnedGames() { return context.settings.learnedGames }, ignoredExecutables: new Set(),
  snapshot: () => ({ processes: [{ exe: 'arena.exe', pid: 42, startTicks: 1 }], foregroundPid: 42 }),
  detectUnknownGame: () => null,
  resolveGameSettings: (perGame, game, globals) => ({ quality: perGame[game]?.quality ?? globals.quality, bufferLength: perGame[game]?.bufferLength ?? globals.bufferLength }),
  parseQuality: quality => quality, captureAddon: { setBufferLength(value) { buffers.push(value) }, setQuality(value) { qualities.push(value) }, setCurrentGame() {} },
  mainWindow: { webContents: { send() {} } }, updateOverlay() {}, loadGameDb() {},
}
const buffers = [], qualities = []
runInNewContext(compile(declarations.map(node => node.getText(tree)).join('\n') +
  '\nglobalThis.probe = { detectKnownGame, startGameDetection }'), context)
assert.equal(context.probe.detectKnownGame(context.snapshot().processes, 42).name, 'My Arena', 'learned name must win over bundled name')
context.probe.startGameDetection()
assert.equal(buffers.at(-1), 60, 'game override must apply on detection')
assert.equal(qualities.at(-1), '720p 30fps')
context.snapshot = () => ({ processes: [], foregroundPid: 0 })
// Invoke the interval callback captured from startGameDetection.
// The callback is saved by the setInterval stub below.
assert.equal(typeof context.poll, 'function')
context.poll()
assert.equal(buffers.at(-1), 30, 'global buffer must return when the game exits')
assert.equal(qualities.at(-1), '1080p 60fps')

const installCall = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' &&
      node.arguments[0]?.getText(tree) === "'install-update'") installCall.push(node.getText(tree))
  ts.forEachChild(node, visit)
}
visit(tree)
assert.equal(installCall.length, 1)
let installHandler
let ipcStatus = 'idle', ipcInstalls = 0
const ipcContext = { app: {}, getUpdateState: () => ({ status: ipcStatus }),
  installUpdateNow: () => { ipcInstalls++ },
  ipcMain: { handle: (_name, handler) => { installHandler = handler } } }
runInNewContext(compile(installCall[0]), ipcContext)
installHandler()
assert.equal(ipcContext.app.isQuitting, undefined, 'idle install request must not mark the app as quitting')
assert.equal(ipcInstalls, 0)
ipcStatus = 'ready'
installHandler()
assert.equal(ipcInstalls, 1)
assert.equal(ipcContext.app.isQuitting, true)
ipcContext.installUpdateNow = () => { throw Error('installer failed') }
assert.throws(() => installHandler(), /installer failed/)
assert.equal(ipcContext.app.isQuitting, false, 'failed install must restore normal window behavior')
console.log('PASS: update failure/ready/install state, learned game naming, per-game apply/restore, and install IPC gate')
