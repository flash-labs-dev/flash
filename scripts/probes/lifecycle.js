// Exercise lifecycle handlers without starting Electron or the installed app.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
function execute(nodes, context) {
  const code = ts.transpileModule(nodes.map(node => node.getText(tree)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, context)
}
function namedFunction(name) {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `missing ${name}`)
  return node
}

;(async () => {
  const items = []
  const window = {
    minimized: true, visible: false, focused: false,
    isMinimized() { return this.minimized },
    isDestroyed() { return false },
    restore() { this.minimized = false },
    show() { this.visible = true },
    focus() { if (!this.minimized) this.focused = true },
    webContents: { send() {} },
  }
  const trayContext = {
    tray: { setContextMenu(menu) { items.push(...menu) }, setToolTip() {} },
    Menu: { buildFromTemplate: template => template }, mainWindow: window,
    isRecording: false, captureAddon: null, shell: {}, app: { quit() {}, isReady: () => true },
    activeClipsFolder() { return '' },
  }
  execute([namedFunction('showMainWindow'), namedFunction('updateTrayMenu')], trayContext)
  trayContext.updateTrayMenu()
  items.find(item => item.label === 'Show Flash').click()
  assert.equal(window.minimized, false, 'tray Show Flash must restore a minimized window')
  assert.equal(window.focused, true)
  console.log('PASS: tray Show Flash restores a minimized window')

  let finish
  const job = new Promise(resolve => { finish = resolve })
  let quits = 0
  const quitHandlers = tree.statements.filter(node => ts.isExpressionStatement(node) &&
    node.getText(tree).startsWith("app.on('before-quit'"))
  assert.equal(quitHandlers.length, 1)
  const pendingQuit = {
    app: { on(_event, handler) { this.beforeQuit = handler } },
    pendingOutputJobs: new Set([job]),
    quitAfterOutputJobs: false,
  }
  execute(quitHandlers, pendingQuit)
  let prevented = false
  pendingQuit.app.beforeQuit({ preventDefault() { prevented = true } })
  assert.equal(prevented, true, 'quit must wait for an unfinished output job')
  prevented = false
  pendingQuit.app.beforeQuit({ preventDefault() { prevented = true } })
  assert.equal(prevented, false, 'a second quit must get past a job that never settles')

  const context = {
    app: { on(_event, handler) { this.beforeQuit = handler }, quit() { quits++ } },
    Set, Promise, setImmediate,
  }
  const state = tree.statements.filter(node => ts.isVariableStatement(node) &&
    /pendingOutputJobs|quitAfterOutputJobs/.test(node.getText(tree)))
  execute([...state, namedFunction('trackOutputJob'), ...quitHandlers], context)
  const tracked = context.trackOutputJob(job)
  prevented = false
  context.app.beforeQuit({ preventDefault() { prevented = true } })
  assert.equal(prevented, true, 'quit must wait for an unfinished output job')
  finish()
  await tracked
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(quits, 1, 'quit must resume after the output job settles')
  console.log('PASS: quit waits for an output job and resumes exactly once')
})().catch(error => { console.error(error); process.exitCode = 1 })
