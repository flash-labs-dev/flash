// Self-check for clip and screenshot naming. Run with:
//   node --experimental-strip-types src/shared/clipPath.test.ts
import { strict as assert } from 'node:assert'
import { clipCreatedAt, clipTimestamp, gameFolderName, numberedName, firstFreeName, sidecarPath, isFlashClip, isFlashClipName } from './clipPath.ts'

// Local time, zero padded, in the exact shape the native writer produces.
assert.equal(clipTimestamp(new Date(2026, 7, 13, 9, 5, 3)), '2026-08-13_09-05-03')
assert.equal(clipTimestamp(new Date(2026, 11, 1, 23, 59, 59)), '2026-12-01_23-59-59')

assert.equal(gameFolderName('Rocket League'), 'Rocket League')
assert.equal(gameFolderName(''), 'Unknown')
assert.equal(gameFolderName('   '), 'Unknown')
// Every character Windows refuses, each becoming one underscore rather than
// vanishing - otherwise "A:B" and "AB" would land in the same folder.
assert.equal(gameFolderName('A<B>C:D"E/F\\G|H?I*J'), 'A_B_C_D_E_F_G_H_I_J')
assert.equal(gameFolderName('Pokémon 🎮.', 'win32'), 'Pokémon 🎮')
assert.equal(gameFolderName('R.E.P.O.', 'win32'), 'R.E.P.O')
assert.equal(gameFolderName('R.E.P.O.', 'linux'), 'R.E.P.O.')
assert.equal(gameFolderName('Game . ', 'win32'), 'Game')
assert.equal(gameFolderName('..', 'win32'), 'Unknown')
assert.equal(gameFolderName('..', 'linux'), 'Unknown')
assert.equal(gameFolderName('.', 'linux'), 'Unknown')
assert.equal(gameFolderName('CON', 'win32'), '_CON')
for (const name of ['COM0', 'LPT0', 'COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³']) {
  assert.equal(gameFolderName(name, 'win32'), `_${name}`)
}
assert.equal(gameFolderName('NUL.txt', 'win32'), '_NUL.txt')
assert.equal(gameFolderName('CON', 'linux'), 'CON')
assert.equal(gameFolderName('A\u0001B'), 'A_B')

// The first file is bare; only the second onward is numbered.
assert.equal(numberedName('2026-08-13_09-05-03', 1, '.png'), '2026-08-13_09-05-03.png')
assert.equal(numberedName('2026-08-13_09-05-03', 2, '.png'), '2026-08-13_09-05-03_2.png')

assert.equal(firstFreeName('shot', '.png', []), 'shot.png')
assert.equal(firstFreeName('shot', '.png', ['shot.png']), 'shot_2.png')
assert.equal(firstFreeName('shot', '.png', ['shot.png', 'shot_2.png']), 'shot_3.png')
// Windows paths are case insensitive, so a differently cased existing file is
// still a collision. Getting this wrong overwrites a real screenshot.
assert.equal(firstFreeName('shot', '.png', ['SHOT.PNG'], 'win32'), 'shot_2.png')
assert.equal(firstFreeName('shot', '.png', ['SHOT.PNG'], 'linux'), 'shot.png')
assert.equal(firstFreeName('shot', '.png', ['shot.png.json']), 'shot_2.png')
assert.equal(sidecarPath('round.mp4'), 'round.mp4.json')
assert.equal(sidecarPath('round.png'), 'round.png.json')
// A gap left by a deleted file is reused: the counter returns the first free
// name rather than the highest plus one, which is what the native writer's
// loop does too.
assert.equal(firstFreeName('shot', '.png', ['shot.png', 'shot_3.png']), 'shot_2.png')

// Pruning needs a Flash timestamp name or recognizable Flash metadata.
assert.equal(isFlashClipName('2026-11-11_19-36-34.mp4'), true)
assert.equal(isFlashClipName('2026-11-11_19-36-34.png'), true)
assert.equal(isFlashClipName('2026-11-11_19-36-34_2.mp4'), true)
assert.equal(isFlashClipName('holiday.mp4'), false)
assert.equal(isFlashClipName('2026-11-11 19.36.34.mp4'), false)
assert.equal(isFlashClip('holiday.mp4', null), false)
assert.equal(isFlashClip('2026-11-11_19-36-34.mp4', null), true)
assert.equal(isFlashClip('holiday.mp4', { title: 'holiday', description: 'Takeout export' }), false)
assert.equal(isFlashClip('holiday.mp4', { duration: 12, game: 'Arena', title: 'Takeout export' }), false)
assert.equal(isFlashClip('holiday.mp4', { unreadable: true, starred: true }), false)
assert.equal(isFlashClip('holiday.mp4', { starred: false, tags: ['family'] }), false)
assert.equal(isFlashClip('holiday.mp4', { duration: 12, game: 'Arena' }), true)
assert.equal(isFlashClip('holiday.png', { duration: 0, game: 'Arena' }), true)
assert.equal(isFlashClip('renamed.mp4', { game: 'Shared clip' }), true)
assert.equal(isFlashClip('2026-11-11_19-36-34.mp4', { unreadable: true }), false)
assert.equal(isFlashClip('2026-11-11_19-36-34.mp4', { title: 'Takeout export' }), false)
// Starring then unstarring a clip that had no sidecar leaves only this; the name still proves it.
assert.equal(isFlashClip('2026-11-11_19-36-34.mp4', { starred: false }), true)

// birthtime is authoritative when the filesystem has it; mtime is the fallback
// on mounts where it is 0, and 0 means the age is unknown rather than ancient.
assert.equal(clipCreatedAt({ birthtimeMs: 1000, mtimeMs: 2000 }), 1000)
assert.equal(clipCreatedAt({ birthtimeMs: 0, mtimeMs: 2000 }), 2000)
assert.equal(clipCreatedAt({ birthtimeMs: -1, mtimeMs: 2000 }), 2000)
assert.equal(clipCreatedAt({ birthtimeMs: 0, mtimeMs: 0 }), 0)

console.log('clip path self-check passed')
