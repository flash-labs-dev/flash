export function microphoneError(audioError: string | undefined, enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return audioError?.split('; ').find(error => error.startsWith('Microphone: '))
}
