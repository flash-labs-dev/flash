// Builds the app icon files from assets/icon-source.png, as PNG (tray/window)
// and ICO (shortcuts). Every theme uses the same icon; the per-theme file names
// stay because main.ts loads assets/icons/<theme>.*.
// Uses the Electron already installed for the app — no image library.
//
//   pnpm --filter @flash/desktop exec electron ../../scripts/make-icons.js
//
// Output: assets/icons/<theme>.png (512) and assets/icons/<theme>.ico
const { app, nativeImage } = require('electron')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const THEMES = ['blood', 'ultraviolet', 'cobalt', 'fuchsia', 'indigo', 'bone']

const SIZE = 512
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// ICO is a 6-byte header, one 16-byte directory entry per image, then the image
// payloads. Vista+ accepts PNG payloads directly, so no BMP encoding needed.
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)          // reserved
  header.writeUInt16LE(1, 2)          // type: icon
  header.writeUInt16LE(pngs.length, 4)

  const entries = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)  // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)            // palette count
    entry.writeUInt8(0, 3)            // reserved
    entry.writeUInt16LE(1, 4)         // colour planes
    entry.writeUInt16LE(32, 6)        // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.data)])
}

app.on('ready', () => {
  const outDir = join(__dirname, '..', 'assets', 'icons')
  mkdirSync(outDir, { recursive: true })
  const source = nativeImage.createFromPath(join(__dirname, '..', 'assets', 'icon-source.png'))
  if (source.isEmpty()) throw new Error('assets/icon-source.png is missing or unreadable')
  const full = source.resize({ width: SIZE, height: SIZE, quality: 'best' })
  const pngs = ICO_SIZES.map(size => ({ size, data: source.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  for (const name of THEMES) {
    writeFileSync(join(outDir, `${name}.png`), full.toPNG())
    writeFileSync(join(outDir, `${name}.ico`), buildIco(pngs))
    console.log(`${name}: png 512, ico ${ICO_SIZES.join('/')}`)
  }
  app.exit(0)
})
