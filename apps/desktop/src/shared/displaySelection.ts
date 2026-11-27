export type CaptureDisplay = { id: number; name: string; isPrimary: boolean }

export function selectCaptureDisplay<T extends CaptureDisplay>(displays: T[], id: number, name: string): T | undefined {
  return (name ? displays.find(display => display.name === name) : undefined)
    ?? (!name ? displays.find(display => display.id === id) : undefined)
    ?? displays.find(display => display.isPrimary)
    ?? displays[0]
}
