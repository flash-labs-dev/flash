// Exercises the actual main-process scanner against isolated clip files.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../../apps/desktop/node_modules/typescript')

;(async () => {
  const { migrateSidecars, readSidecarCached, pruneSidecarCache, writeSidecar } = await import('../../apps/desktop/src/shared/clipFiles.ts')
  const { clipCreatedAt, isFlashClipName } = await import('../../apps/desktop/src/shared/clipPath.ts')
  const source = fs.readFileSync(path.join(__dirname, '../../apps/desktop/src/main/main.ts'), 'utf8')
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
  const scan = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'scanClips')
  assert.ok(scan)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-library-data-'))
  try {
    const renamed = path.join(dir, 'my-best_clip.mp4')
    const later = path.join(dir, 'z-later.mp4')
    fs.writeFileSync(renamed, 'clip')
    fs.writeFileSync(later, 'clip')
    writeSidecar(renamed, { tags: ['great'], starred: true, marksSec: [1], duration: 2 })
    const context = {
      ...fs, ...path, readSidecarCached, pruneSidecarCache, migrateSidecars, clipCreatedAt, isFlashClipName,
      activeClipsFolder: () => dir, reportClipError() {}, reportedMissingClipsFolder: '',
      statSync: file => {
        if (file === path.join(dir, 'a-broken.mp4')) throw Object.assign(new Error('moved during scan'), { code: 'ENOENT' })
        return fs.statSync(file)
      },
    }
    const code = ts.transpileModule(scan.getText(tree), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    runInNewContext(`${code}\nglobalThis.scanClips = scanClips`, context)
    fs.writeFileSync(path.join(dir, 'a-broken.mp4'), 'moved clip fixture')
    const clips = context.scanClips()
    assert.equal(clips.length, 2, 'one clip moved during scan must not hide later clips')
    const found = clips.find(clip => clip.filePath === renamed)
    assert.equal(found.title, 'my-best_clip', 'a user-renamed title must retain its punctuation')
    assert.equal(found.starred, true)
    assert.deepEqual(Array.from(found.tags), ['great'])
    assert.deepEqual(Array.from(found.marksSec), [1])
    context.activeClipsFolder = () => path.join(dir, 'missing-folder')
    assert.equal(context.scanClips().length, 0)
    assert.equal(pruneSidecarCache(new Set()), 0, 'switching folders must drop old cached sidecars')
    console.log('PASS: scanner survives moved entries and preserves renamed titles and sidecar metadata')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
