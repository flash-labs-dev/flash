import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CRASH_LOG_MAX_BYTES, recordCrash } from './crashLog.ts'

const folder = mkdtempSync(join(tmpdir(), 'flash-crash-'))
try {
  const log = join(folder, 'crash.log')
  const now = new Date('2026-11-26T12:00:00Z')
  recordCrash(log, new Error('first'), 'uncaughtException', now)
  recordCrash(log, 'second', 'unhandledRejection', now)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /2026-11-26T12:00:00\.000Z uncaughtException\nError: first\n\s+at /)
  assert.match(text, /unhandledRejection\nsecond\n/)

  // A crash loop must not fill the disk: a full log starts again.
  writeFileSync(log, 'x'.repeat(CRASH_LOG_MAX_BYTES + 1))
  recordCrash(log, 'third', 'uncaughtException', now)
  assert.ok(statSync(log).size < 200)

  // Logging runs while the process is dying, so it must never throw.
  assert.doesNotThrow(() => recordCrash(join(folder, 'missing', 'crash.log'), 'x', 'uncaughtException', now))
  assert.doesNotThrow(() => recordCrash(log, Object.create(null), 'uncaughtException', now))
  console.log('crashLog tests passed')
} finally {
  rmSync(folder, { recursive: true, force: true })
}
