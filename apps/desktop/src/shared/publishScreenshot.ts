import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { extname } from 'node:path'

// Native screenshot encoders and frame grabs may leave bytes behind before
// reporting a write failure. Publish only after the writer has finished.
let partialSequence = 0
export async function publishScreenshot(output: string, write: (temporary: string) => Promise<unknown> | unknown): Promise<void> {
  const extension = extname(output)
  const temporary = `${output.slice(0, output.length - extension.length)}.${process.pid}.${++partialSequence}.partial${extension}`
  try {
    await write(temporary)
    renameSync(temporary, output)
  } finally {
    try { if (existsSync(temporary)) unlinkSync(temporary) }
    catch { /* A failed cleanup must not hide the save error. */ }
  }
}
