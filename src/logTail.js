import { open, stat } from 'node:fs/promises'
import { log } from './lib.js'

// Dependency-free growing-file tail. Polls size + reads the delta, so it
// survives log4j's daily rollover (which truncates latest.log back to 0 and
// keeps writing) without needing `tail -F` inside the container.
export function tailFile(path, onLine, { pollMs = 1000 } = {}) {
  let position = null // null = not yet initialized; seek to EOF on first poll

  async function poll() {
    let size
    try {
      ;({ size } = await stat(path))
    } catch {
      return // file not mounted yet / momentarily missing during rollover
    }

    if (position === null) {
      position = size // start tailing from the current end, don't replay history
      return
    }
    if (size < position) {
      log('logTail: file shrank (rollover), resetting to start')
      position = 0
    }
    if (size <= position) return

    const fh = await open(path, 'r')
    try {
      const length = size - position
      const buf = Buffer.alloc(length)
      await fh.read(buf, 0, length, position)
      position = size
      let start = 0
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
          const line = buf.subarray(start, i).toString('utf8').replace(/\r$/, '')
          start = i + 1
          if (line) onLine(line)
        }
      }
      // any trailing partial line is dropped; it'll be re-read whole next poll
      // because we only advance `position` past the last full line we saw
      position -= (buf.length - start)
    } finally {
      await fh.close()
    }
  }

  const timer = setInterval(() => { poll().catch(err => log('logTail: poll failed:', err.message)) }, pollMs)
  poll().catch(err => log('logTail: poll failed:', err.message))
  return () => clearInterval(timer)
}
