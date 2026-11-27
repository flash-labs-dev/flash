// Exercise the tray save action without starting Electron or recording.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const update = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateTrayMenu')
assert.ok(update)
const code = ts.transpileModule(update.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

for (const recording of [false, true]) {
  let menu, tooltip, saves = 0
  const context = {
    tray: { setContextMenu(value) { menu = value }, setToolTip(value) { tooltip = value } },
    Menu: { buildFromTemplate: template => template },
    isRecording: recording,
    showMainWindow() {},
    saveClipNow() { saves++; return Promise.resolve({ path: 'saved.mp4' }) },
    activeClipsFolder() { return '' },
    shell: { openPath() {} },
    app: { quit() {} },
  }
  runInNewContext(code, context)
  context.updateTrayMenu()
  assert.match(tooltip, recording ? /Recording/ : /stopped/, 'tray tooltip follows replay buffer state')
  const item = menu.find(entry => entry.label === 'Save Replay Clip')
  assert.ok(item, 'tray must offer Save Replay Clip')
  assert.equal(item.enabled, recording, 'save action follows replay buffer state')
  if (recording) {
    item.click()
    assert.equal(saves, 1, 'tray save uses the shared clip save path')
  }
}
console.log('PASS: tray saves the replay through the shared path when buffering')
