// Exercise recording IPC and display recovery with a fake capture addon.
// No Electron process or capture device is started.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
function handler(name, context) {
  let call
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments[0]?.getText(tree) === `'${name}'` &&
        node.expression.getText(tree) === 'ipcMain.handle') call = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(call, `missing ${name}`)
  const code = ts.transpileModule(`${call.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, context)
  return context.handlers[name]
}

const handlers = {}
const messages = []
let nativeRecording = true
let nativeDisplay = 0
let saveSucceeds = true
const context = {
  ipcMain: { handle: (name, callback) => { handlers[name] = callback } }, handlers,
  settings: { displayId: 0, bufferLength: 30, shortClipSeconds: 15 },
  sessionDisplayId: null,
  sanitiseSettings: partial => partial,
  availableDisplay: id => id,
  saveSettings() { return saveSucceeds }, applyCaptureSettings() {}, checkCaptureHealth() {}, updateOverlay() {},
  console: { ...console, warn() {} },
  captureAddon: {
    stopReplayBuffer() { throw new Error('stop failed') },
    getStatus() { return { recording: nativeRecording, displayId: nativeDisplay } },
    setDisplay(id) {
      nativeDisplay = id
      // The native binding throws after applying the display if capture restart fails.
      nativeRecording = false
      throw new Error('display switched but capture restart failed')
    },
  },
  setRecordingState: value => messages.push(value),
  readRecordingState: () => nativeRecording,
}

handler('capture-stop-replay', context)()
assert.equal(messages.at(-1), true, 'a failed stop must retain the native recording state')
console.log('PASS: failed stop retains the actual recording state')

const setSettings = handler('set-settings', context)
saveSucceeds = false
assert.throws(() => setSettings(null, { displayId: 1 }), /Could not save settings/)
assert.equal(context.settings.displayId, 0, 'a failed save must restore the previous setting')
assert.equal(nativeDisplay, 0, 'a failed save must not switch the native display')
saveSucceeds = true
console.log('PASS: failed settings save rolls back before native side effects')
setSettings(null, { displayId: 1 })
assert.equal(nativeDisplay, 1)
assert.equal(context.settings.displayId, 1, 'a switched display must remain selected after its capture restart fails')
console.log('PASS: display selection follows the native display after a failed restart')

context.captureAddon.setDisplay = () => { throw new Error('failed before switching') }
setSettings(null, { displayId: 0 })
assert.equal(context.settings.displayId, 1, 'a switch rejected before applying must keep the previous display')
console.log('PASS: rejected display switch keeps the previous selection')
