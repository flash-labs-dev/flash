// A path that left the library must not keep its old still.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/renderer/thumbnails.ts'), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

;(async () => {
  const reads = []
  const revoked = []
  let made = 0
  const context = {
    exports: {},
    require: id => id.includes('thumbnailTime') ? {
      thumbnailTime: (marks, duration) => {
        const mark = marks.find(value => Number.isFinite(value) && value >= 0 && value <= duration)
        return mark === undefined ? { timeSec: 0.5, fromMark: false } : { timeSec: mark, fromMark: true }
      },
    } : { clipUrl: file => file },
    Blob: class {},
    URL: { createObjectURL: () => `blob:${++made}`, revokeObjectURL: url => revoked.push(url) },
    window: { flash: { readThumbnail: () => new Promise(resolve => reads.push(() => resolve([1]))) } },
  }
  runInNewContext(code, context)
  const { thumbnailFor, retainThumbnails } = context.exports

  const first = thumbnailFor('a.mp4')
  reads.shift()()
  assert.equal(await first, 'blob:1')
  retainThumbnails([{ filePath: 'a.mp4', kind: 'clip', marksSec: [], durationSec: 10 }])
  assert.equal(await thumbnailFor('a.mp4'), 'blob:1')
  const marked = thumbnailFor('a.mp4', 'clip', [2], 10)
  reads.shift()()
  assert.equal(await marked, 'blob:2')
  const movedMark = thumbnailFor('a.mp4', 'clip', [3], 10)
  reads.shift()()
  assert.equal(await movedMark, 'blob:3')

  // Repeatedly moving the first mark must not retain one blob per old position.
  retainThumbnails([{ filePath: 'a.mp4', kind: 'clip', marksSec: [3], durationSec: 10 }])
  assert.deepEqual(revoked, ['blob:1', 'blob:2'])
  assert.equal(await thumbnailFor('a.mp4', 'clip', [3], 10), 'blob:3')

  retainThumbnails([])
  assert.deepEqual(revoked, ['blob:1', 'blob:2', 'blob:3'])
  const second = thumbnailFor('a.mp4')
  // Removed again while still loading: the late result is dropped.
  retainThumbnails([])
  const third = thumbnailFor('a.mp4')
  reads.shift()()
  assert.equal(await second, null)
  reads.shift()()
  assert.equal(await third, await thumbnailFor('a.mp4'))
  assert.notEqual(await third, 'blob:1')

  // A still generated for a path that left the library is never saved or leaked.
  const written = []
  context.window.flash = { readThumbnail: async () => null, writeThumbnail: path => written.push(path) }
  context.document = { createElement: tag => {
    if (tag === 'canvas') return { getContext: () => ({ drawImage() {} }), toBlob: done => done({ arrayBuffer: async () => new ArrayBuffer(1) }) }
    const on = {}
    return {
      duration: 10, videoWidth: 16, videoHeight: 9, removeAttribute() {}, load() {},
      addEventListener: (name, listener) => { on[name] = listener },
      set src(_) { setImmediate(() => { on.loadedmetadata(); on.seeked() }) },
    }
  } }
  context.setTimeout = setTimeout
  context.clearTimeout = clearTimeout
  const gone = thumbnailFor('gone.mp4')
  retainThumbnails([])
  const before = revoked.length
  assert.equal(await gone, null)
  assert.deepEqual(written, [])
  assert.equal(revoked.length, before + 1)
  assert.ok(await thumbnailFor('kept.mp4'))
  assert.deepEqual(written, ['kept.mp4'])
  console.log('thumbnail cache ok')
})().catch(error => { console.error(error); process.exitCode = 1 })
