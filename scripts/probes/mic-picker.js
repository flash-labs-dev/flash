// Mic picker must reload its device list when a microphone is plugged in or removed.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/SettingsView.tsx'), 'utf8')
const tree = ts.createSourceFile('SettingsView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = (match, node) => match(node) ? node : ts.forEachChild(node, child => find(match, child))
const picker = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MicPicker', tree)
const effect = find(node => ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect', picker)

let listed = 0
const listeners = new Set()
const context = {
  setDevices() {},
  window: { flash: { listMicDevices: async () => { listed++; return { devices: [] } } } },
  navigator: { mediaDevices: {
    addEventListener: (type, fn) => { if (type === 'devicechange') listeners.add(fn) },
    removeEventListener: (type, fn) => { listeners.delete(fn) },
  } },
}
const cleanup = runInNewContext(ts.transpileModule(`(${effect.arguments[0].getText(tree)})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context)

for (const fn of listeners) fn()
assert.equal(listed, 2, 'a device change must reload the microphone list')
cleanup()
assert.equal(listeners.size, 0, 'listener removed when Settings closes')
console.log('PASS: microphone list follows device changes')
