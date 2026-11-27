// Drive the main window lifecycle without starting Electron.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const names = ['createWindow', 'showMainWindow', 'dispatchFlashLink', 'flushFlashLinks']
const functions = names.map(name => {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `missing ${name}`)
  return node.getText(tree)
})
const instance = tree.statements.find(node => ts.isIfStatement(node) && node.expression.getText(tree) === '!primaryInstance')
assert.ok(instance)

let now = 0
const windows = []
class FakeWindow extends EventEmitter {
  constructor() {
    super()
    this.webContents = new EventEmitter()
    this.sent = []
    this.webContents.send = (...args) => this.sent.push(args)
    this.webContents.reload = () => { this.reloads++ }
    this.reloads = 0
    windows.push(this)
  }
  loadURL() {}
  loadFile() {}
  isDestroyed() { return !!this.destroyed }
  isMinimized() { return false }
  isVisible() { return true }
  show() { assert.equal(this.destroyed, undefined) }
  focus() {}
  restore() {}
}
const app = new EventEmitter()
app.isReady = () => true
app.requestSingleInstanceLock = () => true
const context = {
  BrowserWindow: FakeWindow, app, process: { env: { NODE_ENV: 'development' } },
  Date: { now: () => now }, console: { error() {} },
  startedByWindows: false, resource: () => '', join, __dirname: '',
  playbackVisible: () => true, parseFlashLink: raw => raw.startsWith('flash://') ? raw : null,
  flashLinkFromArgv: argv => argv.find(arg => arg.startsWith('flash://')) ?? null,
  captureCommand: () => null, AUTOSTART_FLAG: '--autostart',
}
const code = `let mainWindow = null; let rendererReady = false; const pendingFlashLinks = [];
${functions.join('\n')}
const primaryInstance = app.requestSingleInstanceLock(); ${instance.getText(tree)}
globalThis.state = () => ({ mainWindow, rendererReady, pending: [...pendingFlashLinks] });
globalThis.dispatch = dispatchFlashLink; globalThis.showMain = showMainWindow;`
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)

context.showMain()
const first = windows[0]
first.webContents.emit('did-finish-load')
assert.equal(context.state().rendererReady, true)
first.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
assert.equal(first.reloads, 1)
assert.equal(context.state().rendererReady, false)
app.emit('second-instance', {}, ['flash://clip/queued'])
assert.equal(context.state().pending.length, 1)
assert.equal(first.sent.some(([channel]) => channel === 'open-shared-clip'), false)
first.webContents.emit('did-finish-load')
assert.equal(context.state().pending.length, 0)
assert.equal(first.sent.filter(([channel]) => channel === 'open-shared-clip').length, 1)
first.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
first.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
assert.equal(first.reloads, 2, 'repeated crashes must stop reloading')
now = 61_000
first.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
assert.equal(first.reloads, 3, 'recovery resumes after the cooldown')
first.destroyed = true
app.emit('second-instance', {}, [])
assert.equal(windows.length, 2, 'second instance must replace a destroyed window')
first.emit('closed')
assert.equal(context.state().mainWindow, windows[1], 'late close must not clear the replacement')
console.log('PASS: renderer crash recovery is bounded; links queue through reload; destroyed windows are replaced')
