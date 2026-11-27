// Exercise the real Editor callbacks with a trim IPC response held in flight.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/Editor.tsx'), 'utf8')
const tree = ts.createSourceFile('Editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const callbacks = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['queueTrimWrite', 'save'].includes(node.name.getText(tree))) {
    callbacks.set(node.name.getText(tree), node.getText(tree))
  }
  ts.forEachChild(node, visit)
}
visit(tree)
assert.equal(callbacks.size, 2)

let finishTrim
const calls = []
const notes = []
const context = {
  useCallback: fn => fn,
  videoRef: { current: { duration: 10 } }, duration: 10,
  trimWrite: { current: Promise.resolve() }, trimWriteFailed: { current: false },
  clip: { filePath: 'clip.mp4' }, range: { inSec: 2, outSec: 8 },
  audioTracks: [], liveGains: {}, saturation: 100, saveMode: { reason: 'trim' },
  setSaving() {}, setSaveNote(note) { notes.push(note) }, formatTimecode: String,
  window: { flash: {
    setClipTrim: () => { calls.push('trim'); return new Promise(resolve => { finishTrim = resolve }) },
    saveClipEdit: (_path, options) => { calls.push(['save', options.startSeconds, options.endSeconds]); return Promise.resolve({}) },
  } },
}
const code = ts.transpileModule(`const ${callbacks.get('queueTrimWrite')}; const ${callbacks.get('save')}; globalThis.callbacks = { queueTrimWrite, save }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText
runInNewContext(code, context)

;(async () => {
  context.callbacks.queueTrimWrite({ inSec: 2, outSec: 8 })
  await Promise.resolve() // queueTrimWrite dispatches its IPC request
  assert.equal(typeof finishTrim, 'function')
  const saving = context.callbacks.save()
  assert.deepEqual(calls, ['trim'], 'Save started before the pending trim write finished')
  finishTrim({ trim: { inSec: 2, outSec: 8 } })
  await saving
  assert.deepEqual(calls, ['trim', ['save', 2, 8]])
  // Save clears the note first, so a refused save must say why again.
  context.trimWriteFailed.current = true
  calls.length = 0
  await context.callbacks.save()
  assert.deepEqual(calls, [])
  assert.match(String(notes.at(-1)), /Could not save trim/, 'A refused save was silent')
  console.log('PASS: Save waits for the final trim write')
})().catch(error => { console.error(error); process.exitCode = 1 })
