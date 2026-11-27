// Run with: node --experimental-strip-types src/shared/saveError.test.ts
import { strict as assert } from 'node:assert'
import { saveError } from './saveError.ts'

assert.equal(saveError({ code: 'ENOSPC', message: 'write failed' }), 'The clips drive is full. Free up space and try again.')
assert.equal(saveError(new Error('Could not flush output: No space left on device')), 'The clips drive is full. Free up space and try again.')
assert.equal(saveError({ code: 'ENOENT', message: 'missing' }), 'The clips folder or drive is unavailable. Check that the drive is connected and choose a valid clips folder.')
assert.equal(saveError(new Error('Could not publish output: No such file or directory')), 'The clips folder or drive is unavailable. Check that the drive is connected and choose a valid clips folder.')
assert.equal(saveError({ code: 'ENODEV', message: 'drive gone' }), 'The clips folder or drive is unavailable. Check that the drive is connected and choose a valid clips folder.')
assert.equal(saveError({ code: 'EACCES', message: 'blocked' }), 'Flash cannot write to the clips folder. Check the folder permissions or choose another folder.')
assert.equal(saveError(new Error('Could not flush output: Permission denied')), 'Flash cannot write to the clips folder. Check the folder permissions or choose another folder.')
assert.equal(saveError({ code: 'EPERM', message: 'blocked' }), 'Flash cannot write to the clips folder. Check the folder permissions or choose another folder.')
assert.equal(saveError({ code: 'EBUSY', message: 'busy' }), 'The save file is in use by another program. Close it there and try again.')
assert.equal(saveError(new Error('Could not publish output: Device or resource busy')), 'The save file is in use by another program. Close it there and try again.')
assert.equal(saveError(new Error('could not flush output')), 'could not flush output')
assert.equal(saveError('unknown native failure'), 'unknown native failure')

const hresult = (code: number) => saveError(new Error(`IMFSinkWriter::Finalize failed (HRESULT ${code})`))
assert.match(hresult(2147942512), /drive is full/)
assert.match(hresult(2147942403), /unavailable/)
assert.match(hresult(2147942405), /cannot write/)
assert.match(hresult(2147942432), /in use/)
assert.equal(hresult(2147500037), 'IMFSinkWriter::Finalize failed (HRESULT 2147500037)')

const win32 = (code: number) => saveError(new Error(`could not flush output (Win32 ${code})`))
for (const code of [39, 112]) assert.match(win32(code), /drive is full/)
for (const code of [2, 3, 21, 53, 64, 67, 1231]) assert.match(win32(code), /unavailable/)
for (const code of [5, 19]) assert.match(win32(code), /cannot write/)
for (const code of [32, 33]) assert.match(win32(code), /in use/)
assert.match(win32(206), /path is too long/)
assert.match(win32(1117), /I\/O error/)
assert.equal(win32(9999), 'could not flush output (Win32 9999)')

for (const [code, phrase] of [
  ['EROFS', 'cannot write'], ['EDQUOT', 'drive is full'],
  ['ENAMETOOLONG', 'path is too long'], ['EIO', 'I/O error'],
]) {
  assert.match(saveError({ code, message: 'native write failed' }), new RegExp(phrase))
  assert.match(saveError(new Error(`native write failed (${code})`)), new RegExp(phrase))
}
assert.equal(saveError(new Error('native write failed (EUNKNOWN)')), 'native write failed (EUNKNOWN)')

console.log('save error self-check passed')
