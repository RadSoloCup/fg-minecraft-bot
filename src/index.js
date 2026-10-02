import { config, assertConfig } from './config.js'
import { log, postWebhook } from './lib.js'
import { tailFile } from './logTail.js'
import { RconClient, tellrawAll } from './rcon.js'
import { GatewayClient } from './bot/gateway.js'
import { parseCommand, runCommand } from './bot/commands.js'
import { setGateway } from './health.js'
import { startMonitor, onServerStopping, onServerStarted, refreshSoon } from './monitor.js'

assertConfig()

const avatarUrl = player => `https://mc-heads.net/avatar/${encodeURIComponent(player)}/64`

// Matches log4j's line prefix: "[13Sep2026 09:47:04.674] [Server thread/INFO] [logger/]: <rest>"
// (older logs use "04Aug.2024", hence the dot).
const LINE_RE = /^\[\d{1,2}[\w.]+\d{4} [\d:.]+\] \[[^\]]+\] \[([^\]]*)\]: (.*)$/
const ADVANCEMENT_RE = /^(\S+) has (made the advancement|completed the challenge|reached the goal) \[(.+)\]$/

// Players seen online, so death messages (which have no fixed wording, mods
// add their own) can be recognized as "<online player> <anything>".
const online = new Set()

function parseLine(raw) {
  const m = raw.match(LINE_RE)
  if (!m) return null
  const [, logger, rest] = m
  let mm
  if ((mm = rest.match(/^<([^>]+)> ([\s\S]*)$/))) return { type: 'chat', player: mm[1], text: mm[2] }
  if ((mm = rest.match(/^(\S+) joined the game$/))) return { type: 'join', player: mm[1] }
  if ((mm = rest.match(/^(\S+) left the game$/))) return { type: 'leave', player: mm[1] }
  if (/DedicatedServer/.test(logger) && /^Done \(/.test(rest)) return { type: 'started' }
  if (!/MinecraftServer/.test(logger)) return null
  if (rest === 'Stopping server') return { type: 'stopping' }
  if ((mm = rest.match(ADVANCEMENT_RE))) return { type: 'advancement', player: mm[1], kind: mm[2], title: mm[3] }
  const first = rest.split(' ')[0]
  if (online.has(first) && rest.length > first.length + 1) return { type: 'death', player: first, text: rest }
  return null
}

// RCON is needed for every command (even MC-side ones, e.g. `!mc list`), so
// it's created whenever a password is configured — independent of whether the
// Fluxer bot (FLUXER_BOT_TOKEN) is set up for the reverse direction.
const rcon = config.rcon.password ? new RconClient(config.rcon) : null

// Runs `!mc ...` commands regardless of which side they were typed on: replies
// go back into the game via tellraw AND into Fluxer (so Discord sees it too,
// via Crosstalk) — everyone sees the same answer. Returns false if `content`
// wasn't a recognized command at all (caller should fall through to plain
// chat relay).
async function handleCommand(invoker, content) {
  const parsed = parseCommand(content)
  if (!parsed) return false
  if (!rcon) {
    log(`command "${content}" from ${invoker} ignored — RCON_PASSWORD not configured`)
    return true
  }
  log(`command: ${invoker} -> ${config.commandPrefix} ${parsed.cmd} ${parsed.arg}`.trim())

  let result
  try {
    result = await runCommand(parsed, rcon, invoker)
  } catch (err) {
    result = { text: `Error: ${err.message}` }
  }
  if (!result) return true

  await tellrawAll(rcon, { text: `[${invoker}] ${result.text}`, color: 'yellow' })
  await postWebhook({
    username: 'Minecraft',
    avatar_url: avatarUrl(invoker),
    content: result.embed ? undefined : `**${invoker}** ran \`${config.commandPrefix} ${parsed.cmd}\`\n${result.text}`,
    embeds: result.embed ? [result.embed] : undefined,
  }, result.files).catch(err => log('command reply webhook failed:', err.message))

  return true
}

// ── Minecraft -> Fluxer ──────────────────────────────────────────────────────
log(`watching ${config.logPath} for chat`)
tailFile(config.logPath, raw => {
  const ev = parseLine(raw)
  if (!ev) return
  const relay = content => postWebhook({ username: 'Minecraft', avatar_url: ev.player ? avatarUrl(ev.player) : undefined, content })
    .catch(err => log('webhook post failed:', err.message))

  switch (ev.type) {
    case 'join':
    case 'leave':
      if (ev.type === 'join') online.add(ev.player); else online.delete(ev.player)
      refreshSoon()
      return relay(`_${ev.player} ${ev.type === 'join' ? 'joined' : 'left'} the game_`)
    case 'death':
      return relay(`_${ev.text}_`)
    case 'advancement':
      return relay(`**${ev.player}** ${ev.kind} **${ev.title}**`)
    case 'stopping':
      online.clear()
      return onServerStopping()
    case 'started':
      return onServerStarted()
  }

  handleCommand(ev.player, ev.text).then(handled => {
    if (handled) return
    postWebhook({ username: ev.player, avatar_url: avatarUrl(ev.player), content: ev.text })
      .catch(err => log('webhook post failed:', err.message))
  }).catch(err => log('command handling failed:', err.message))
})

// Seed the online list (the log tail starts at the end of the file, so it
// never sees joins that happened before the bridge started).
if (rcon) {
  rcon.exec('list').then(out => {
    const m = out.match(/players online:\s*(.*)/)
    for (const n of (m?.[1] || '').split(',').map(x => x.trim()).filter(Boolean)) online.add(n)
  }).catch(() => {})
}

// ── Fluxer -> Minecraft (optional; needs a bot token) ───────────────────────
if (config.fluxer.botToken) {
  const gw = new GatewayClient()
  setGateway(gw)

  gw.on('ready', () => log(`bot: relaying #${config.fluxer.channelId} <-> RCON`))
  gw.on('fatal', code => log(`bot: fatal gateway error ${code} — check FLUXER_BOT_TOKEN`))
  gw.on('message', async d => {
    if (d.channel_id !== config.fluxer.channelId) return
    const username = d.author?.username || 'Fluxer'
    const content = (d.content || '').replace(/\s+/g, ' ').trim()
    if (!content) return

    const handled = await handleCommand(username, content).catch(err => {
      log('command handling failed:', err.message)
      return false
    })
    if (handled || !rcon) return
    await tellrawAll(rcon, { text: `[Fluxer] ${username}: ${content.slice(0, 400)}`, color: 'aqua' })
  })

  gw.start().catch(err => log(`bot: failed to start: ${err.message}`))
  if (rcon) startMonitor(rcon, gw)

  function shutdown() {
    try { gw.stop() } catch {}
    try { rcon?.close() } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} else {
  log('FLUXER_BOT_TOKEN not set — Fluxer -> Minecraft relay disabled (MC -> Fluxer still active)')
}
