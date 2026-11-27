const HOUR_MS = 60 * 60 * 1000

// Only the exact shapes Flash writes. The clips folder can hold the user's own
// files, and this list decides what gets deleted without asking.
// A name Flash chose: its timestamp, or any clip (renamed ones too) plus the
// suffix a trim, edit, export or frame grab adds. " (2)" is the collision suffix.
const STEM = String.raw`(?:\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(?:_\d+)?` +
  String.raw`|.+ - (?:trim|edit|(?:\d+MB|1GB)(?: H264)?|\d\d-\d\d-\d\d\.\d{3}))(?: \(\d+\))?`

const PARTIAL_SHAPES = [
  // Windows writer: <stem>.<pid>.<n>.partial.mp4, plus the exporter's retry file
  String.raw`\.\d+\.\d+\.partial\.(?:mp4(?:\.try\.mp4)?|png)`,
  // Shared clip download: <stem>.mp4.partial.<uuid>
  String.raw`\.mp4\.partial\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
  // Linux mkstemp: <stem>.mp4.XXXXXX. A digit or capital is required so that a
  // hand-made "<name>.mp4.backup" is never matched.
  String.raw`\.mp4\.(?=[A-Za-z]*[A-Z0-9])[A-Za-z0-9]{6}`
].map((tail) => new RegExp(`^${STEM}${tail}$`))

export function isStalePartialClip(name: string, modifiedAt: number, now: number): boolean {
  return PARTIAL_SHAPES.some((shape) => shape.test(name))
    && Number.isFinite(modifiedAt) && modifiedAt > 0 && now - modifiedAt > HOUR_MS
}
