// Run the LibraryView window-key handler with the modal and input states it sees.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/LibraryView.tsx'), 'utf8')
const tree = ts.createSourceFile('LibraryView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'LibraryView') {
    const findEffect = child => {
      if (ts.isCallExpression(child) && child.expression.getText(tree) === 'useEffect' &&
          child.getText(tree).includes("window.addEventListener('keydown', onKeyDown)")) effect = child.arguments[0]
      ts.forEachChild(child, findEffect)
    }
    findEffect(node)
  }
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(effect, 'LibraryView keyboard effect exists')

let handler, dialogOpen = true, focused = 0, selected = 0, cleared = 0
class Input {}
class Textarea {}
class Element { isContentEditable = false }
const context = {
  shortcutsEnabled: true,
  searchRef: { current: { focus() { focused++ } } },
  displayedIds: ['clip'], selectedIds: { size: 1 },
  onSelectAll: () => selected++, onClearSelection: () => cleared++,
  HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLElement: Element,
  document: { querySelector: () => dialogOpen ? {} : null },
  window: { addEventListener: (_, callback) => { handler = callback }, removeEventListener() {} },
}
const js = ts.transpileModule(`globalThis.mount = ${effect.getText(tree)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(js, context)
context.mount()
const key = (name, ctrlKey = false, target = new Element()) => {
  const event = { key: name, ctrlKey, metaKey: false, target, preventDefault() {} }
  handler(event)
}

key('/')
key('a', true)
key('Escape')
assert.deepEqual([focused, selected, cleared], [0, 0, 0], 'modal keyboard input must not change the library')
dialogOpen = false
key('/', false, new Input())
assert.equal(focused, 0, 'typing in an input must not focus search')
key('/')
key('a', true)
key('Escape')
assert.deepEqual([focused, selected, cleared], [1, 1, 1], 'library shortcuts work without a dialog')
console.log('PASS: library shortcuts ignore open dialogs and text inputs')
