// The clip toast window: the Electron build's toast markup (shared/windowTemplates.ts),
// filled from the query string the Rust side opens this page with.
import { toastHtml } from '../../desktop/src/shared/windowTemplates'
import { DEFAULT_THEME } from '../../desktop/src/shared/themes'
import geist from '../../../assets/fonts/geist.woff2?url'

const query = new URLSearchParams(location.search)
document.open()
document.write(toastHtml(DEFAULT_THEME, geist, Number(query.get('duration')) || 0, query.get('game') ?? '', query.get('position') ?? 'top-left'))
document.close()
