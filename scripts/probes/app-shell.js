// App shell checks without launching Electron: bulk delete, update banner, window buttons.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/App.tsx'), 'utf8')
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(match, node = tree) {
  return match(node) ? node : ts.forEachChild(node, child => find(match, child))
}
const declared = name => find(node =>
  (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(tree) === name)

async function bulkDelete(failing, shown = ['a', 'b']) {
  const calls = { cleared: 0, refreshed: 0 }
  let request
  const context = {
    selectedClips: ['a', 'b'].map(filePath => ({ id: filePath, filePath, size: 1 })),
    shownClips: shown.map(id => ({ id })),
    useCallback: fn => fn, formatBytes: String,
    setConfirmRequest: value => { request = value },
    setSaveState: () => {},
    clearSelected: () => { calls.cleared++ },
    refreshClips: async () => { calls.refreshed++ },
    window: { flash: { deleteClip: async path => ({ deleted: path !== failing }) } },
  }
  runInNewContext(ts.transpileModule(`const ${declared('deleteSelection').getText(tree)}\ndeleteSelection()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  await request.onConfirm()
  return { ...calls, body: request.body }
}

let failures = 0
async function check(label, action) {
  try { await action(); console.log(`PASS: ${label}`) }
  catch (error) { failures++; console.error(`FAIL: ${label}: ${error.message}`) }
}

;(async () => {
  await check('bulk delete keeps the selection when a clip fails', async () => {
    const { body, ...calls } = await bulkDelete('b')
    assert.deepEqual(calls, { cleared: 0, refreshed: 1 })
    assert.doesNotMatch(body, /hidden/)
  })
  await check('bulk delete clears the selection when all succeed', async () => {
    const { body: _body, ...calls } = await bulkDelete(null)
    assert.deepEqual(calls, { cleared: 1, refreshed: 1 })
  })
  await check('bulk delete says how many selected clips are filtered out', async () => {
    assert.match((await bulkDelete(null, ['a'])).body, /1 of them is hidden by the current filters/)
  })
  await check('"Later" dismisses one update version, not every later one', () => {
    // assert.ok, not assert.match: a failed match would print the whole file.
    assert.ok(!/setUpdateDismissed\(true\)/.test(source), 'dismissal is a bare boolean')
    assert.ok(/update\.version[^\n]*!== dismissedUpdate/.test(source), 'banner ignores the version')
  })
  await check('window buttons are not redefined on every render', () => {
    const controls = declared('WindowControls')
    assert.ok(!find(node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) &&
      node.parent.name.getText(tree) === 'Button', controls), 'Button is defined inside WindowControls')
  })
  if (failures) process.exitCode = 1
})()
