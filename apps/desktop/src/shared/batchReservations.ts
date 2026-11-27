export class BatchReservations {
  private readonly active = new Map<number, { token: string; paths: string[] }>()

  replace(sender: number, token: string, paths: string[]): string[] {
    const previous = this.release(sender)
    this.active.set(sender, { token, paths })
    return previous
  }

  release(sender: number, token?: string): string[] {
    const current = this.active.get(sender)
    if (!current || (token !== undefined && current.token !== token)) return []
    this.active.delete(sender)
    return current.paths
  }
}
