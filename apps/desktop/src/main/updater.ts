import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

// Flash updates itself from its GitHub releases: it checks shortly after launch
// and every few hours after, downloads in the background, and installs when the
// app is next closed. Nothing interrupts a recording or asks the user anything.
//
// Only a packaged build updates. A dev build has no installer to replace, and
// FLASH_NO_UPDATE lets a tester or a packaged build under test opt out.

const CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export type UpdateState = { status: 'idle' | 'downloading' | 'ready'; version?: string }

let state: UpdateState = { status: 'idle' }
let onChange: (state: UpdateState) => void = () => {}

export function getUpdateState(): UpdateState {
  return state
}

function setState(next: UpdateState) {
  state = next
  onChange(state)
}

export function startAutoUpdate(listener: (state: UpdateState) => void) {
  onChange = listener
  if (!app.isPackaged || process.env.FLASH_NO_UPDATE) return
  // A Linux package that is not an AppImage cannot replace itself.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // The releases are betas, so a pre-release has to count as an update.
  autoUpdater.allowPrerelease = true
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
  // A failed check is ordinary - offline, rate limited, no release yet - and
  // the next interval tries again.
  autoUpdater.on('error', (error) => console.warn('Auto-update:', error?.message ?? error))

  const check = () => { autoUpdater.checkForUpdates().catch((error) => console.warn('Auto-update check failed:', error?.message ?? error)) }
  setTimeout(check, CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS).unref()
}
