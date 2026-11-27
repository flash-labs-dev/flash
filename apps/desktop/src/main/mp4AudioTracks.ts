import { open } from 'node:fs/promises'

// Read only MP4 box headers. Audio samples can be gigabytes and need not be decoded.
export async function countMp4AudioTracks(path: string): Promise<number> {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    const header = Buffer.alloc(16)
    async function boxes(start: number, end: number, visit: (type: string, body: number, limit: number) => Promise<void>) {
      for (let offset = start; offset + 8 <= end;) {
        if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) throw new Error('Incomplete MP4 box')
        const type = header.toString('ascii', 4, 8)
        const shortSize = header.readUInt32BE(0)
        let length = shortSize === 0 ? end - offset : shortSize
        let headerSize = 8
        if (shortSize === 1) {
          if ((await file.read(header, 0, 8, offset + 8)).bytesRead !== 8) throw new Error('Incomplete MP4 box')
          length = Number(header.readBigUInt64BE(0))
          headerSize = 16
        }
        if (!Number.isSafeInteger(length) || length < headerSize || offset + length > end) throw new Error('Invalid MP4 box')
        await visit(type, offset + headerSize, offset + length)
        offset += length
      }
    }
    let count = 0
    let foundMoov = false
    await boxes(0, size, async (type, body, limit) => {
      if (type !== 'moov') return
      foundMoov = true
      await boxes(body, limit, async (type, body, limit) => {
        if (type !== 'trak') return
        await boxes(body, limit, async (type, body, limit) => {
          if (type !== 'mdia') return
          await boxes(body, limit, async (type, body, limit) => {
            if (type !== 'hdlr') return
            if (limit - body < 12 || (await file.read(header, 0, 12, body)).bytesRead !== 12) throw new Error('Invalid MP4 handler')
            if (header.toString('ascii', 8, 12) === 'soun') count++
          })
        })
      })
    })
    if (!foundMoov) throw new Error('MP4 metadata missing')
    return count
  } finally { await file.close() }
}
