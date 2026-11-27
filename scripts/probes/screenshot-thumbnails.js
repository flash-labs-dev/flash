// Exercises the real main-process IPC handlers with isolated filesystem services.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const handlers = new Map()
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' &&
      ts.isStringLiteral(node.arguments[0])) handlers.set(node.arguments[0].text, node.getText(tree))
  ts.forEachChild(node, visit)
}
visit(tree)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-shot-thumb-'))
;(async () => {
try {
  const { publishScreenshot } = await import('../../apps/desktop/src/shared/publishScreenshot.ts')
  const { saveError } = await import('../../apps/desktop/src/shared/saveError.ts')
  const cache = path.join(dir, 'userData')
  const thumbnails = ['thumbnail-read', 'thumbnail-write'].map(name => handlers.get(name))
  assert.ok(thumbnails.every(Boolean))
  const thumbnailDeclaration = source.match(/const thumbnailFile = \(filePath: string, markSec\?: number \| null\): string \| null => \{[\s\S]*?\n  \}/)
  assert.ok(thumbnailDeclaration)
  const thumbnailContext = {
    ipcMain: { handle: (name, fn) => thumbnailContext.handlers.set(name, fn) }, handlers: new Map(),
    isInsideClips: () => true, existsSync: () => true,
    statSync: () => ({ size: 50, mtimeMs: 100 }), createHash, join: path.join,
    dirname: path.dirname, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync,
    readFileSync: fs.readFileSync, app: { getPath: () => cache },
    process: { platform: 'linux' }, Uint8Array, Number,
  }
  const thumbnailCode = ts.transpileModule(`${thumbnailDeclaration[0]}\n${thumbnails.join('\n')}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(thumbnailCode, thumbnailContext)
  const first = '/clips/Game.mp4', second = '/clips/game.mp4'
  const write = thumbnailContext.handlers.get('thumbnail-write')
  const read = thumbnailContext.handlers.get('thumbnail-read')
  if (process.env.FLASH_PROBE_CASE !== 'frame') {
    assert.equal(write(null, first, Uint8Array.from([1, 2, 3])), true)
    assert.equal(read(null, second), null, 'case-distinct Linux clips must not share a thumbnail')
    assert.equal(read(null, first, 2), null, 'marked clips must not reuse the unmarked still')
    assert.equal(write(null, first, Uint8Array.from([4]), 2), true)
    assert.equal(read(null, first, 3), null, 'changing the mark must not reuse the old still')
    console.log('PASS: Linux case-distinct paths have separate thumbnail cache entries')
  }

  const frameHandler = handlers.get('save-clip-frame')
  assert.ok(frameHandler)
  const messages = []
  const frameContext = {
    ipcMain: { handle: (name, fn) => { frameContext.handler = fn } },
    isInsideClips: () => true, existsSync: fs.existsSync, extname: path.extname,
    dirname: path.dirname, basename: path.basename, join: path.join,
    reserveOutput: desired => ({ path: desired, release() {} }),
    writeFileSync: fs.writeFileSync, writeSidecar: () => { throw new Error('metadata disk failure') },
    readSidecar: () => null, mainWindow: { webContents: { send: (...args) => messages.push(args) } },
    publishScreenshot, saveError, showSaveError: (...args) => messages.push(['save-error', ...args]),
    Number, String, Math, Uint8Array,
  }
  runInNewContext(ts.transpileModule(frameHandler, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, frameContext)
  const clip = path.join(dir, 'clip.mp4')
  fs.writeFileSync(clip, 'clip')
  if (process.env.FLASH_PROBE_CASE !== 'thumbnail') {
    const result = await frameContext.handler(null, clip, 1, Uint8Array.from([137, 80, 78, 71]))
    assert.ok(result.path, 'a saved PNG must be reported as saved when metadata fails')
    assert.equal(fs.existsSync(result.path), true)
    assert.equal(messages.some(([name]) => name === 'clip-saved-refresh'), true)
    assert.equal(messages.some(([name]) => name === 'save-error'), true, 'the metadata failure must be shown')
    console.log('PASS: frame grab remains successful when optional metadata fails')
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
})().catch(error => { console.error(error); process.exitCode = 1 })
