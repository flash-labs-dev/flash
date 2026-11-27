// Exercise DialogFrame's real focus effect without launching Electron.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/ui.tsx'), 'utf8')
const tree = ts.createSourceFile('ui.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'DialogFrame') {
    const findEffect = child => {
      if (ts.isCallExpression(child) && child.expression.getText(tree) === 'useLayoutEffect') effect = child.arguments[0]
      ts.forEachChild(child, findEffect)
    }
    findEffect(node)
  }
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(effect, 'DialogFrame focus effect exists')

function check(openerSurvives) {
  let active
  const opener = { isConnected: true, focus() { active = this } }
  const fallback = { isConnected: true, getClientRects: () => [{}], focus() { active = this } }
  const cancel = { isConnected: true, focus() { active = this } }
  const confirm = { isConnected: true, focus() { active = this } }
  const dialog = {
    contains: node => node === cancel || node === confirm,
    querySelectorAll: () => [cancel, confirm],
    addEventListener() {}, removeEventListener() {},
  }
  const document = {
    activeElement: opener,
    querySelectorAll: () => [fallback, cancel, confirm],
    addEventListener() {}, removeEventListener() {},
  }
  const js = ts.transpileModule(`globalThis.mount = ${effect.getText(tree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = { document, dialogRef: { current: dialog } }
  runInNewContext(js, context)
  const cleanup = context.mount()
  assert.equal(active, cancel, 'dialog receives initial focus')
  opener.isConnected = openerSurvives
  cleanup()
  assert.equal(active, openerSurvives ? opener : fallback,
    'closing restores the opener or a surviving control when delete removes it')
}

check(true)
check(false)
console.log('PASS: dialog restores focus after both surviving and deleted openers')
