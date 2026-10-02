import { config } from './config.js'
import { log, postWebhook } from './lib.js'
import { formatDuration } from './stats.js'

// Background watcher: keeps the bot's status line showing the player count,
// and posts to chat when the server goes down and when it comes back.
//
// States: unknown (just started) -> up <-> stopping (log said "Stopping
// server") / down (RCON stopped answering without a clean stop).

const FAILS_BEFORE_ALERT = 2 // consecutive failed polls, so a blip doesn't alert

let rcon = null
let gw = null
let state = 'unknown'
let downSince = null
let fails = 0
let expectedRestartAt = 0
let lastPresence = ''
let refreshTimer = null

const say = content => postWebhook({ username: 'Minecraft', content })
  .catch(err => log('monitor: webhook failed:', err.message))

function presence(status, text) {
  const key = `${status}|${text}`
  if (!gw || key === lastPresence) return
  lastPresence = key
  gw.setPresence(status, text)
}

function markUp(players) {
  if (state === 'stopping' || state === 'down') {
    const took = downSince ? ` after ${formatDuration((Date.now() - downSince) / 1000)}` : ''
    say(`**The Minecraft server is back up${took}.**`)
    log(`monitor: server back up${took}`)
  }
  state = 'up'
  downSince = null
  fails = 0
  if (players) presence('online', `${players.count}/${players.max} online`)
}

async function poll() {
  try {
    const out = await rcon.exec('list')
    const m = out.match(/There are (\d+) of a max of (\d+) players online/)
    markUp(m ? { count: Number(m[1]), max: Number(m[2]) } : null)
  } catch (err) {
    fails++
    if (state === 'unknown') {
      state = 'down'
      downSince = Date.now()
      presence('dnd', 'Server offline')
    } else if (state === 'up' && fails >= FAILS_BEFORE_ALERT) {
      state = 'down'
      downSince = Date.now() - config.monitorIntervalMs * (fails - 1)
      say('**The Minecraft server has stopped responding.** It may have crashed; it should restart on its own.')
      log(`monitor: server down (${err.message})`)
      presence('dnd', 'Server offline')
    }
  }
}

// The log said "Stopping server": a clean shutdown (restart, maintenance).
export function onServerStopping() {
  if (state !== 'up') return
  state = 'stopping'
  downSince = Date.now()
  presence('dnd', 'Server restarting')
  // A passed restart vote already announced itself.
  if (Date.now() - expectedRestartAt > 5 * 60_000) say('**The Minecraft server is shutting down** (restart or maintenance).')
}

// The log said "Done (...)": the server finished starting.
export function onServerStarted() {
  if (state === 'stopping' || state === 'down') markUp(null)
  refreshSoon()
}

export function noteExpectedRestart() { expectedRestartAt = Date.now() }

// Join/leave: update the player count shortly, not on the next minute tick.
export function refreshSoon() {
  if (!rcon) return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => poll().catch(() => {}), 3000)
}

export function startMonitor(rconClient, gateway) {
  rcon = rconClient
  gw = gateway
  poll().catch(() => {})
  setInterval(() => poll().catch(() => {}), config.monitorIntervalMs)
}
