import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Exercise the main-process detector without starting Electron or the capture addon.
const source = readFileSync(new URL('../main/main.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const names = ['detectKnownGame', 'detectCurrentGame']
const selected = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''))
assert.equal(selected.length, names.length)
const games = (JSON.parse(readFileSync(
  new URL('../../../../packages/flash-detector/src/games.json', import.meta.url), 'utf8')) as
  { games: { processName: string; displayName: string }[] }).games
assert.equal(games.length, 50, 'the Games screen count matches the bundled list')
const gameDb = Object.fromEntries(games.map(game => [game.processName.toLowerCase(), game.displayName]))
type FixtureProcess = { pid: number; exe: string; path: string; windowTitle: string; workingSet: number; startTicks: number }
const processes: FixtureProcess[] = []
const context = {
  process: { platform: 'win32' }, GAME_DB: gameDb, currentGamePid: 0,
  learnedGames: () => ({}), ignoredExecutables: new Set<string>(),
  snapshot: () => ({ processes, foregroundPid: processes[0]?.pid ?? 0 }),
  // A candidate that satisfies the old title/path/memory guess.
  detectUnknownGame: () => ({ name: 'Claude', pid: 10, exe: 'Claude.exe', unknown: true }),
} as Record<string, any>
runInNewContext(ts.transpileModule(selected.map(node => node.getText(tree)).join('\n') +
  '\nglobalThis.detector = { detectKnownGame, detectCurrentGame }', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context)
const detector = context.detector as {
  detectKnownGame: (processes: FixtureProcess[], foregroundPid: number) => { name: string } | null
  detectCurrentGame: () => { name: string } | null
}
processes.push({ pid: 10, exe: 'Claude.exe', path: 'C:\\Program Files\\Claude\\Claude.exe',
  windowTitle: 'Claude', workingSet: 300 * 1024 * 1024, startTicks: 1 })
assert.equal(detector.detectCurrentGame(), null, 'a large Claude window is not a game')
for (const exe of ['javaw.exe', 'leagueclient.exe']) {
  assert.equal(detector.detectKnownGame([{ ...processes[0], exe }], 10), null,
    `${exe} alone does not prove a game is running`)
}
assert.equal(detector.detectKnownGame([{ ...processes[0], exe: 'cs2.exe' }], 10)?.name, 'CS2')
const java = (windowTitle: string) =>
  detector.detectKnownGame([{ ...processes[0], exe: 'javaw.exe', windowTitle }], 10)?.name
for (const title of ['Minecraft 1.21.1', 'Minecraft* 1.20.1 - Singleplayer', 'Minecraft NeoForge* 1.21.1', 'Minecraft 24w14a']) {
  assert.equal(java(title), 'Minecraft (Java)', title)
}
for (const title of ['', 'Minecraft Launcher 2.1', 'Minecraft server', 'IntelliJ IDEA 2025.1']) {
  assert.equal(java(title), undefined, title)
}
context.learnedGames = () => ({ 'customgame.exe': 'Custom Game' })
assert.equal(detector.detectKnownGame([{ ...processes[0], exe: 'CustomGame.exe' }], 10)?.name, 'Custom Game')
console.log('game detection self-check passed')
