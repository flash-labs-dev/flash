// Exercise voice dispatch without launching Electron or capture hardware.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const handler = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleVoiceCommand')
assert.ok(handler, 'missing handleVoiceCommand')

const calls = []
const settings = { voiceEnabled: true, voicePhrase: 'flash clip short', shortClipSeconds: 15 }
const context = {
  settings,
  mainWindow: { webContents: { send: channel => calls.push(channel) } },
  saveClipNow: seconds => { calls.push(seconds === undefined ? 'full' : `short:${seconds}`) },
  saveScreenshotNow: () => { calls.push('screenshot') },
}
runInNewContext(ts.transpileModule(handler.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nglobalThis.dispatch = handleVoiceCommand', context)

let failures = 0
function check(label, action) {
  try { action(); console.log(`PASS: ${label}`) }
  catch (error) { failures++; console.error(`FAIL: ${label}: ${error.message}`) }
}

check('built-in short command wins over matching custom phrase', () => {
  context.dispatch('flash clip short', 0.9)
  assert.deepEqual(calls, ['hotkey-clip', 'short:15'])
})

check('queued voice callback is ignored after listening is disabled', () => {
  calls.length = 0
  settings.voiceEnabled = false
  context.dispatch('flash screenshot', 0.9)
  assert.deepEqual(calls, [])
})

if (failures) process.exitCode = 1
