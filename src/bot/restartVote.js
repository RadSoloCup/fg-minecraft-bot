import { tellrawAll } from '../rcon.js'
import { postWebhook, log } from '../lib.js'
import { randomWarQuote } from './warQuotes.js'

const VOTE_WINDOW_MS = 2 * 60 * 1000
const WARNING_LEAD_MS = 5 * 60 * 1000
const COOLDOWN_MS = 60 * 60 * 1000

// Module-scope state is fine here -- this file is only ever imported once,
// into the single long-running bot process (not re-entrant per-request like
// a web handler), so it survives across command calls the same way the
// RCON connection itself does.
let activeVote = null // { votesFor: Set<lowercase name>, initiator, timer }
let cooldownUntil = 0

function majorityNeeded(onlineCount) {
  return Math.floor(onlineCount / 2) + 1
}

function rollD20() {
  return Math.floor(Math.random() * 20) + 1
}

async function announce(rcon, text) {
  await tellrawAll(rcon, { text, color: 'gold' })
  await postWebhook({ username: 'Minecraft', content: text }).catch(err => log('restartVote: webhook failed:', err.message))
}

async function listPlayers(rcon) {
  const out = await rcon.exec('list')
  const m = out.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/)
  if (!m) return { count: 0, names: [] }
  return { count: Number(m[1]), names: m[3].split(',').map(s => s.trim()).filter(Boolean) }
}

function clearActiveVote() {
  if (activeVote?.timer) clearTimeout(activeVote.timer)
  activeVote = null
}

async function expireVote(rcon) {
  if (!activeVote) return
  const { count } = await listPlayers(rcon).catch(() => ({ count: 0 }))
  const needed = majorityNeeded(count)
  const had = activeVote.votesFor.size
  clearActiveVote()

  // A dead-even split (only possible with an even online count, since
  // `needed` is a majority = half + 1) can never close the gap on its own —
  // it just sits here until time runs out. Rather than declare it a flat
  // failure, break the tie with a d20 instead.
  if (count > 0 && count % 2 === 0 && had === count / 2) {
    await resolveTie(rcon, had, count)
    return
  }

  await announce(rcon, `Restart vote failed — only ${had}/${needed} needed votes came in within 2 minutes.`)
}

async function passVote(rcon) {
  clearActiveVote()
  cooldownUntil = Date.now() + COOLDOWN_MS
  await announce(rcon, '⚠ Restart vote passed! Server restarting in 5 minutes.')

  setTimeout(() => {
    announce(rcon, '⚠ Server restarting in 1 minute!').catch(err => log('restartVote: 1-min warning failed:', err.message))
  }, WARNING_LEAD_MS - 60_000)

  setTimeout(() => {
    announce(rcon, '⚠ Restarting now...').catch(err => log('restartVote: final warning failed:', err.message))
  }, WARNING_LEAD_MS - 10_000)

  setTimeout(async () => {
    try {
      await rcon.exec('save-all')
      await rcon.exec('stop')
    } catch (err) {
      // The RCON socket dies with the JVM the moment `stop` takes effect, so
      // exec() rejecting here (connection closed) is the expected outcome,
      // not a real failure -- the container's restart:unless-stopped policy
      // brings it back on its own.
      log('restartVote: stop sequence ended (expected once the server exits):', err.message)
    }
  }, WARNING_LEAD_MS)
}

// Called from expireVote() once the 2-minute window closes on an exact
// 50/50 split (activeVote is already cleared by then). Settles it with a
// d20 instead of just declaring the vote failed.
async function resolveTie(rcon, votes, count) {
  const roll = rollD20()
  const restarts = roll >= 11
  await announce(rcon, `🎲 Vote tied ${votes}-${count - votes} — rolling a d20 to break it... it's a ${roll}! (1-10 = stand down, 11-20 = restart)`)
  if (restarts) {
    await passVote(rcon)
  } else {
    await announce(rcon, `Server stands. ${randomWarQuote()}`)
  }
}

// Called for `!mc restart` (and aliases) from either side of the bridge.
// Returning null means this function already broadcast its own message (via
// announce()) and the caller should NOT also post the generic "[invoker] ..."
// wrapper -- index.js's handleCommand() already treats a falsy result this
// way for exactly this purpose.
export async function cmdRestartVote(rcon, invoker) {
  const name = String(invoker || '').toLowerCase()
  if (!name) return { text: 'Could not identify you as a player.' }

  if (Date.now() < cooldownUntil) {
    const mins = Math.ceil((cooldownUntil - Date.now()) / 60_000)
    return { text: `A restart already happened recently — vote is on cooldown for ${mins} more minute${mins === 1 ? '' : 's'}.` }
  }

  const { count, names } = await listPlayers(rcon)
  if (count === 0) {
    return { text: 'No players online to vote — ask an admin to restart directly.' }
  }
  if (!names.some(n => n.toLowerCase() === name)) {
    return { text: `Only players currently online can vote (didn't find "${invoker}" in the online list).` }
  }

  const needed = majorityNeeded(count)
  const isNewVote = !activeVote

  if (isNewVote) {
    activeVote = { votesFor: new Set([name]), initiator: invoker }
    activeVote.timer = setTimeout(() => expireVote(rcon).catch(err => log('restartVote: expire failed:', err.message)), VOTE_WINDOW_MS)
  } else if (activeVote.votesFor.has(name)) {
    return { text: `You already voted (${activeVote.votesFor.size}/${needed} needed).` }
  } else {
    activeVote.votesFor.add(name)
  }

  const votes = activeVote.votesFor.size

  if (votes >= needed) {
    await passVote(rcon)
    return null
  }

  await announce(rcon, isNewVote
    ? `${invoker} started a restart vote! Type "!mc restart" to vote yes. Need ${needed}/${count} online players within 2 minutes.`
    : `${invoker} voted to restart (${votes}/${needed} needed).`)
  return null
}
