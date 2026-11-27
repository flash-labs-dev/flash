export function repeatGate(quietMs: number): (now: number) => boolean {
  let lastPress = -Infinity
  return now => {
    const accepted = now - lastPress >= quietMs
    lastPress = now
    return accepted
  }
}
