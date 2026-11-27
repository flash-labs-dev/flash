import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishScreenshot } from './publishScreenshot.ts'

const folder = mkdtempSync(join(tmpdir(), 'flash-screenshot-'))
const output = join(folder, 'frame.png')
try {
  await assert.rejects(publishScreenshot(output, temporary => {
    writeFileSync(temporary, Buffer.from([137, 80]))
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  }), /disk full/)
  assert.equal(existsSync(output), false)
  assert.deepEqual(readdirSync(folder), [])

  await publishScreenshot(output, temporary => { writeFileSync(temporary, Buffer.from('complete')) })
  assert.equal(readFileSync(output, 'utf8'), 'complete')
  assert.deepEqual(readdirSync(folder), ['frame.png'])

  await assert.rejects(publishScreenshot(output, temporary => {
    writeFileSync(temporary, Buffer.from('truncated'))
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
  }), /permission denied/)
  assert.equal(readFileSync(output, 'utf8'), 'complete')
  assert.deepEqual(readdirSync(folder), ['frame.png'])

  // No extension: the temporary name must stay beside the output.
  const bare = join(folder, 'bare')
  await publishScreenshot(bare, temporary => {
    assert.ok(temporary.startsWith(`${bare}.`), temporary)
    writeFileSync(temporary, Buffer.from('complete'))
  })
  assert.equal(readFileSync(bare, 'utf8'), 'complete')
} finally {
  rmSync(folder, { recursive: true, force: true })
}

console.log('screenshot publication self-check passed')
