// Order matters: error reporting first, then the desktop preload sets
// window.flash (through the shim), then the UI mounts.
import './errors'
import '../../desktop/src/preload/preload'
import '../../desktop/src/renderer/main'
