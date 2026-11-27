// Run: node --experimental-vm-modules scripts/probes/renderer-startup.js
// Times V8 parsing and top-level evaluation of the exact built renderer index.
// The expected missing-document error occurs at the final ReactDOM mount line.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { performance } = require('node:perf_hooks')

const build = path.resolve(__dirname, '../../apps/desktop/out/renderer')
const html = fs.readFileSync(path.join(build, 'index.html'), 'utf8')
const index = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/)?.[1]
if (!index) throw new Error('Could not find built renderer index script')
const file = path.join(build, 'assets', index)
const source = fs.readFileSync(file, 'utf8')
const mountLine = source.slice(0, source.indexOf('ReactDOM.createRoot(document.getElementById')).split('\n').length
const samples = []

async function measure() {
  const context = vm.createContext({})
  const start = performance.now()
  const module = new vm.SourceTextModule(source, { context })
  const parsed = performance.now()
  await module.link(() => { throw new Error('Unexpected static import') })
  const linked = performance.now()
  try {
    await module.evaluate()
    throw new Error('Expected the final ReactDOM mount to need document')
  } catch (error) {
    if (error.name !== 'ReferenceError' || error.message !== 'document is not defined' ||
        !error.stack.includes(`:${mountLine}:`)) throw error
  }
  return { parse: parsed - start, link: linked - parsed, evaluate: performance.now() - linked }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2
}

;(async () => {
  for (let i = 0; i < 21; i++) samples.push(await measure())
  const warm = samples.slice(1)
  const format = value => Number(value.toFixed(2))
  console.log(JSON.stringify({ file: index, bytes: fs.statSync(file).size,
    cold: Object.fromEntries(Object.entries(samples[0]).map(([key, value]) => [key, format(value)])),
    warmMedian: Object.fromEntries(['parse', 'link', 'evaluate'].map(key => [key, format(median(warm.map(sample => sample[key])))])),
    warmMin: Object.fromEntries(['parse', 'evaluate'].map(key => [key, format(Math.min(...warm.map(sample => sample[key])))])),
    warmMax: Object.fromEntries(['parse', 'evaluate'].map(key => [key, format(Math.max(...warm.map(sample => sample[key])))])),
  }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })