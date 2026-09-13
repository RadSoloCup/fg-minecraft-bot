import { config, assertConfig } from './config.js'
import { log, postWebhook } from './lib.js'
import { tailFile } from './logTail.js'
import { RconClient, tellrawAll } from './rcon.js'
import { GatewayClient } from './bot/gateway.js'

assertConfig()

const avatarUrl = player => `https://mc-heads.net/avatar/${encodeURIComponent(player)}/64`

// Matches log4j's line prefix: "[13Sep2026 09:47:04.674] [Server thread/INFO] [logger/]: <rest>"
const LINE_RE = /^\[\d{1,2}\w+\d{4} [\d:.]+\] \[[^\]]+\] \[[^\]]*\]: (.*)$/

function parseLine(raw) {
  const m = raw.match(LINE_RE)
  if (!m) return null
  const rest = m[1]
  let mm
  if ((mm = rest.match(/^<([^>]+)> ([\s\S]*)$/))) return { type: 'chat', player: mm[1], text: mm[2] }
  if ((mm = rest.match(/^(\S+) joined the game$/))) return { type: 'join', player: mm[1] }
  if ((mm = rest.match(/^(\S+) left the game$/))) return { type: 'leave', player: mm[1] }
  return null
}

// ── Minecraft -> Fluxer ──────────────────────────────────────────────────────
log(`watching ${config.logPath} for chat`)
tailFile(config.logPath, raw => {
  const ev = parseLine(raw)
  if (!ev) return
  const payload = ev.type === 'chat'
    ? { username: ev.player, avatar_url: avatarUrl(ev.player), content: ev.text }
    : { username: 'Minecraft', content: `_${ev.player} ${ev.type === 'join' ? 'joined' : 'left'} the game_` }
  postWebhook(payload).catch(err => log('webhook post failed:', err.message))
})

// ── Fluxer -> Minecraft (optional; needs a bot token) ───────────────────────
if (config.fluxer.botToken) {
  const rcon = new RconClient(config.rcon)
  const gw = new GatewayClient()

  gw.on('ready', () => log(`bot: relaying #${config.fluxer.channelId} -> RCON`))
  gw.on('fatal', code => log(`bot: fatal gateway error ${code} — check FLUXER_BOT_TOKEN`))
  gw.on('message', async d => {
    if (d.channel_id !== config.fluxer.channelId) return
    const username = d.author?.username || 'Fluxer'
    const content = (d.content || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    if (!content) return
    await tellrawAll(rcon, { text: `[Fluxer] ${username}: ${content}`, color: 'aqua' })
  })

  gw.start().catch(err => log(`bot: failed to start: ${err.message}`))

  function shutdown() {
    try { gw.stop() } catch {}
    try { rcon.close() } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} else {
  log('FLUXER_BOT_TOKEN not set — Fluxer -> Minecraft relay disabled (MC -> Fluxer still active)')
}
