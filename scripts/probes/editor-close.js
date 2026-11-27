// The Back button must obey the same rule as Escape: no closing mid-save.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/Editor.tsx'), 'utf8')
const close = source.slice(source.indexOf('const closeEditor'), source.indexOf('const changeTrim'))
assert.ok(/^\s*if \(saving\) return/m.test(close), 'closeEditor closes while a save is running')
assert.ok(/\}, \[[^\]]*\bsaving\b[^\]]*\]\)/.test(close), 'closeEditor does not track saving')
console.log('PASS: editor stays open while saving')
