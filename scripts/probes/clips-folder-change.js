// Run the real picker IPC handler with isolated services; never open a dialog or app.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
let picker
for (const node of tree.statements) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'setupIPC') {
    for (const statement of node.body.statements) {
      if (statement.getText(tree).startsWith("ipcMain.handle('pick-clips-folder'")) picker = statement
    }
  }
}
assert.ok(picker, 'picker handler exists')
const code = ts.transpileModule(picker.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

async function run({ save, setDir }) {
  const calls = []
  const context = {
    ipcMain: { handle(_channel, handler) { this.handler = handler } },
    mainWindow: {},
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['new-folder'] }) },
    settings: { clipsFolder: 'old-folder' },
    activeClipsFolder() { return context.settings.clipsFolder },
    saveSettings() { calls.push('save'); return save },
    ensureClipsFolder() { calls.push('ensure'); return null },
    captureAddon: { setClipsDir(folder) { calls.push(`engine:${folder}`); if (setDir === 'throw' && folder === 'new-folder') throw Error('engine refused') } },
    console: { warn() {} },
  }
  runInNewContext(code, context)
  let result, error
  try { result = await context.ipcMain.handler() } catch (caught) { error = caught }
  return { calls, result, error, folder: context.settings.clipsFolder }
}

;(async () => {
  const failedSave = await run({ save: false })
  assert.ok(failedSave.error, 'save failure must reach the UI')
  assert.equal(failedSave.folder, 'old-folder', 'failed save must restore the prior setting')
  assert.ok(!failedSave.calls.includes('engine:new-folder'), 'engine must not switch after a failed save')
  console.log('PASS: failed folder save cannot report success or switch capture')

  const failedEngine = await run({ save: true, setDir: 'throw' })
  assert.ok(failedEngine.error, 'engine failure must reach the UI')
  assert.equal(failedEngine.folder, 'old-folder', 'failed engine switch must restore the prior setting')
  console.log('PASS: failed engine folder switch cannot report success')

  const success = await run({ save: true })
  assert.equal(success.result, 'new-folder')
  assert.equal(success.folder, 'new-folder')
  assert.ok(success.calls.includes('engine:new-folder'))
  console.log('PASS: successful folder change updates capture and returns the new folder')

  const appSource = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/renderer/App.tsx'), 'utf8')
  const appTree = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let buttonHandler
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'onPickFolder') buttonHandler = node.initializer.expression
    ts.forEachChild(node, visit)
  }
  visit(appTree)
  assert.ok(buttonHandler, 'Settings folder button handler exists')
  const notices = []
  const ui = {
    Error,
    window: { flash: { pickClipsFolder: async () => { throw Error('Could not save clips folder') } } },
    settingsRevision: { current: 0 }, settingsRef: { current: { clipsFolder: 'old-folder' } },
    setSettings() {}, refreshClips() {}, setSaveState(value) { notices.push(value) },
  }
  const uiCode = ts.transpileModule(`globalThis.pick = ${buttonHandler.getText(appTree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  runInNewContext(uiCode, ui)
  await ui.pick()
  assert.match(notices.at(-1)?.error ?? '', /Could not save clips folder/)
  assert.equal(ui.settingsRevision.current, 0, 'failed pick must leave the visible folder choice alone')
  console.log('PASS: Settings reports a folder change failure')
})().catch(error => { console.error(error); process.exitCode = 1 })
