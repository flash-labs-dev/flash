// Run with: node --experimental-strip-types src/shared/scrubSeek.test.ts
import { strict as assert } from 'node:assert'
import { createScrubSeekScheduler, type SeekableVideo } from './scrubSeek.ts'

function harness() {
  const listeners = new Map<string, Set<() => void>>()
  let time = 0
  let seeking = false
  const writes: number[] = []
  const frames = new Map<number, () => void>()
  let nextFrame = 0
  const video: SeekableVideo = {
    get currentTime() { return time },
    set currentTime(value) {
      assert.equal(seeking, false, 'overlapping seek')
      writes.push(value)
      time = value
      seeking = true
      emit('seeking')
    },
    get seeking() { return seeking },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
  }
  function emit(type: string) { for (const listener of listeners.get(type) ?? []) listener() }
  const scheduler = createScrubSeekScheduler(video,
    callback => { const id = ++nextFrame; frames.set(id, callback); return id },
    id => { frames.delete(id) })
  return {
    scheduler, writes, frames,
    tick() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    },
    settle() { seeking = false; emit('seeked') },
    abort(at: number) { time = at; seeking = false },
  }
}

const scrub = harness()
scrub.scheduler.request(1)
scrub.scheduler.request(2)
assert.equal(scrub.frames.size, 1)
scrub.tick()
assert.deepEqual(scrub.writes, [2])
scrub.scheduler.request(3)
scrub.scheduler.request(4)
scrub.tick()
assert.deepEqual(scrub.writes, [2])
scrub.settle()
scrub.tick()
assert.deepEqual(scrub.writes, [2, 4])
scrub.settle()
scrub.tick()
assert.equal(scrub.frames.size, 0)

// A same-time target emits no seeked event and must leave the queue usable.
scrub.scheduler.request(4)
scrub.tick()
assert.deepEqual(scrub.writes, [2, 4])
assert.equal(scrub.frames.size, 0)
scrub.scheduler.request(5)
scrub.tick()
assert.deepEqual(scrub.writes, [2, 4, 5])

// Aborted seeks may omit seeked. The next animation frame detects idle media.
scrub.scheduler.request(6)
scrub.abort(3)
scrub.tick()
assert.deepEqual(scrub.writes, [2, 4, 5, 6])
scrub.scheduler.dispose()
assert.equal(scrub.frames.size, 0)
scrub.scheduler.request(7)
scrub.tick()
assert.deepEqual(scrub.writes, [2, 4, 5, 6])

// A replacement clip gets a new scheduler and no destination from the old one.
const replacement = harness()
replacement.scheduler.request(9)
replacement.tick()
assert.deepEqual(replacement.writes, [9])
replacement.scheduler.dispose()
