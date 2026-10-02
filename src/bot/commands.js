import { config } from '../config.js'
import { findRecipe } from '../mcdata.js'
import { findModdedRecipe, findKeybinds } from '../moddata.js'
import { renderMap, readWorldSpawn } from '../worldmap.js'
import { cmdRestartVote } from './restartVote.js'
import { backendChecks } from '../health.js'
import { playerStats, leaderboard, METRICS, playerPass, passLeaderboard } from '../stats.js'

const p = () => config.commandPrefix

export function parseCommand(content) {
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  const prefix = config.commandPrefix
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null
  const rest = trimmed.slice(prefix.length).trim()
  const m = rest.match(/^(\S+)([\s\S]*)$/)
  const cmd = (m ? m[1] : 'help').toLowerCase()
  const arg = (m ? m[2].trim() : '').replace(/\s+/g, ' ')
  return { cmd, arg, args: arg.split(/\s+/).filter(Boolean) }
}

// ── RCON-backed helpers ──────────────────────────────────────────────────────

async function listPlayers(rcon) {
  const out = await rcon.exec('list')
  const m = out.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/)
  if (!m) return { count: 0, max: 0, names: [] }
  return { count: Number(m[1]), max: Number(m[2]), names: m[3].split(',').map(s => s.trim()).filter(Boolean) }
}

async function getPos(rcon, name) {
  const posOut = await rcon.exec(`data get entity ${name} Pos`)
  if (/no entity was found/i.test(posOut)) return null
  const posMatch = posOut.match(/\[(.+)\]/)
  if (!posMatch) return null
  const [x, y, z] = posMatch[1].split(',').map(s => Number(s.trim().replace(/[df]$/i, '')))
  const dimOut = await rcon.exec(`data get entity ${name} Dimension`).catch(() => '')
  const dim = (dimOut.match(/"([^"]+)"/) || [])[1] || null
  return { x, y, z, dim }
}

// ── commands ─────────────────────────────────────────────────────────────

async function cmdList(rcon) {
  const { count, max, names } = await listPlayers(rcon)
  const text = count === 0
    ? 'No players online right now.'
    : `${count}/${max} online: ${names.join(', ')}`
  return { text }
}

async function cmdWhere(rcon, arg) {
  if (!arg) return { text: `Usage: ${p()} where <player>` }
  const pos = await getPos(rcon, arg)
  if (!pos) return { text: `${arg} isn't online (or doesn't exist).` }
  const dim = (pos.dim || '').replace(/^minecraft:/, '')
  return { text: `${arg} @ ${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)} in ${dim}` }
}

async function cmdSeed(rcon) {
  const out = await rcon.exec('seed')
  const m = out.match(/Seed: \[(-?\d+)\]/)
  return { text: m ? `Seed: ${m[1]}` : out }
}

async function cmdTime(rcon) {
  // Sequential, not Promise.all: vanilla/Forge RCON isn't safe for pipelined
  // commands on one connection and can close the socket if two are in flight.
  const dayOut = await rcon.exec('time query day')
  const dayTimeOut = await rcon.exec('time query daytime')
  const day = (dayOut.match(/The time is (\d+)/) || [])[1]
  const ticks = Number((dayTimeOut.match(/The time is (\d+)/) || [])[1] ?? 0)
  const totalMinutes = Math.floor((((ticks / 1000) + 6) % 24) * 60)
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const mm = String(totalMinutes % 60).padStart(2, '0')
  const label = ticks < 12000 ? 'day' : ticks < 13000 ? 'sunset' : ticks < 23000 ? 'night' : 'sunrise'
  return { text: `Day ${day ?? '?'}, ${hh}:${mm} (${label})` }
}

async function cmdTps(rcon) {
  const out = await rcon.exec('forge tps').catch(err => `error: ${err.message}`)
  const overworld = out.match(/Dim minecraft:overworld[^\n]*Mean tick time: ([\d.]+) ms\. Mean TPS: ([\d.]+)/)
  const overall = out.match(/Overall: Mean tick time: ([\d.]+) ms\. Mean TPS: ([\d.]+)/)
  if (!overworld && !overall) return { text: `Couldn't read TPS (unsupported command?): ${out.split('\n')[0].slice(0, 150)}` }
  const parts = []
  if (overworld) parts.push(`Overworld: ${overworld[2]} TPS (${overworld[1]} ms/tick)`)
  if (overall) parts.push(`Overall: ${overall[2]} TPS (${overall[1]} ms/tick)`)
  return { text: parts.join(' · ') }
}

async function cmdStatus(rcon) {
  let players = null
  try {
    players = await listPlayers(rcon)
  } catch {}

  // One at a time: RCON here drops the connection if commands overlap.
  const timeResult = players ? await cmdTime(rcon).catch(() => null) : null
  const tpsResult = players ? await cmdTps(rcon).catch(() => null) : null
  const checks = await backendChecks({ rconOk: !!players })

  const lines = [players
    ? `Online - ${players.count}/${players.max} player${players.count === 1 ? '' : 's'}` +
      (players.count ? `: ${players.names.join(', ')}` : '')
    : 'Offline - the game server is not responding']
  if (timeResult?.text) lines.push(timeResult.text)
  if (tpsResult?.text) lines.push(tpsResult.text)

  // Minecraft's font has no colour emoji, so the in-game copy uses plain marks.
  const checkLine = (c, yes, no) => `${c.ok ? yes : no} ${c.label}${c.detail ? ` (${c.detail})` : ''}`
  const allUp = checks.every(c => c.ok)
  const text = [
    ...lines,
    ...(config.serverAddress ? [`Address: ${config.serverAddress}`] : []),
    ...checks.map(c => checkLine(c, '✔', '✘')),
  ].join('\n')

  return {
    text,
    embed: {
      title: 'Fighters Guild Minecraft Server',
      description: [...lines, ...(config.serverAddress ? [`Address: \`${config.serverAddress}\``] : [])].join('\n'),
      fields: [{ name: allUp ? 'All systems operational' : 'Some systems are down', value: checks.map(c => checkLine(c, '✅', '❌')).join('\n') }],
      color: !players ? 0xef4444 : allUp ? 0x4ade80 : 0xf59e0b,
      ...(config.serverIconUrl ? { thumbnail: { url: config.serverIconUrl } } : {}),
    },
  }
}

// Discord users reach us through Crosstalk as "Name [Discord]"; drop the tag so
// "!mc stats" with no name can still default to whoever asked.
const cleanInvoker = invoker => String(invoker || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
const STATS_NOTE = 'Saved by the server every few minutes, so online players can lag slightly.'

async function cmdStats(arg, invoker) {
  const name = arg || cleanInvoker(invoker)
  if (!name) return { text: `Usage: ${p()} stats <player>` }
  const s = await playerStats(name)
  if (!s) return { text: `No stats found for "${name}" (they need to have joined the server). Usage: ${p()} stats <player>` }
  const lines = Object.entries(METRICS).map(([key, m]) => `${m.label}: ${m.fmt(s[key])}`)
  return {
    text: `${s.name}\n${lines.join('\n')}`,
    embed: {
      title: `${s.name}'s stats`,
      description: lines.join('\n'),
      color: 0x22d3ee,
      thumbnail: { url: `https://mc-heads.net/avatar/${encodeURIComponent(s.name)}/64` },
      footer: { text: STATS_NOTE },
    },
  }
}

const TOP_ALIASES = { time: 'playtime', played: 'playtime', death: 'deaths', kill: 'kills', mobs: 'kills',
  mining: 'mined', blocks: 'mined', travel: 'distance', km: 'distance', battlepass: 'pass', level: 'pass' }

async function cmdTop(arg) {
  const want = (arg || 'playtime').toLowerCase()
  const metric = TOP_ALIASES[want] || want
  if (metric === 'pass') return cmdPassTop()
  const m = METRICS[metric]
  if (!m) return { text: `Usage: ${p()} top [${[...Object.keys(METRICS), 'pass'].join('|')}]` }
  const rows = await leaderboard(metric)
  if (!rows.length) return { text: `No ${m.label.toLowerCase()} recorded yet.` }
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} - ${m.fmt(r.value)}`)
  return {
    text: `Top ${m.label.toLowerCase()}\n${lines.join('\n')}`,
    embed: { title: `Top ${m.label.toLowerCase()}`, description: lines.join('\n'), color: 0xc9a227, footer: { text: STATS_NOTE } },
  }
}

const bar = (n, total, width = 12) => {
  const filled = Math.round(Math.max(0, Math.min(1, n / total)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

async function cmdPass(arg, invoker) {
  const name = arg || cleanInvoker(invoker)
  if (!name) return { text: `Usage: ${p()} pass <player>` }
  const r = await playerPass(name)
  if (!r) return { text: `No player named "${name}" has joined the server. Usage: ${p()} pass <player>` }
  const maxed = r.level >= r.maxLevel
  const lines = [
    `Season: ${r.season.name} (ends ${shortDate(r.season.endDate)})`,
    `Level ${r.level}/${r.maxLevel}`,
    maxed ? 'Pass complete!'
      : r.seasonXp === 0 ? 'No XP yet this season (progress starts on their next login).'
      : `${bar(r.xpIntoLevel, r.xpPerLevel)} ${r.xpIntoLevel}/${r.xpPerLevel} XP to level ${r.level + 1}`,
  ]
  return {
    text: `${r.name}'s battlepass\n${lines.join('\n')}`,
    embed: {
      title: `${r.name}'s battlepass`,
      description: lines.join('\n'),
      color: maxed ? 0xc9a227 : 0x4ade80,
      thumbnail: { url: `https://mc-heads.net/avatar/${encodeURIComponent(r.name)}/64` },
      footer: { text: STATS_NOTE },
    },
  }
}

async function cmdPassTop() {
  const { season, rows } = await passLeaderboard()
  if (!rows.length) return { text: `Nobody has battlepass XP in ${season.name} yet.` }
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} - level ${r.level} (${r.seasonXp.toLocaleString('en-US')} XP)`)
  return {
    text: `Battlepass leaders, ${season.name}\n${lines.join('\n')}`,
    embed: { title: `Battlepass leaders: ${season.name}`, description: lines.join('\n'), color: 0xc9a227, footer: { text: STATS_NOTE } },
  }
}

async function cmdRecipe(arg) {
  if (!arg) return { text: `Usage: ${p()} recipe <item> — checks this modpack first, then vanilla` }

  // This pack's own items first (covers modded items and any pack-specific
  // overrides), vanilla as a fallback for anything not made by a mod.
  const modded = await findModdedRecipe(arg).catch(() => null)
  if (modded) {
    return {
      text: `${modded.title}\n${modded.lines.join('\n')}`,
      embed: { title: modded.title, description: '```\n' + modded.lines.join('\n') + '\n```', color: 0x22d3ee, footer: { text: `${modded.modId} · this modpack` } },
    }
  }

  const r = await findRecipe(arg)
  if (!r) return { text: `No recipe found for "${arg}" in this modpack or vanilla.` }
  return {
    text: `${r.title}\n${r.lines.join('\n')}`,
    embed: { title: r.title, description: '```\n' + r.lines.join('\n') + '\n```', color: 0xc9a227, footer: { text: 'vanilla recipe data · misode/mcmeta' } },
  }
}

async function cmdKeybind(arg) {
  const matches = await findKeybinds(arg).catch(() => null)
  if (matches === null) return { text: `Couldn't reach the keybind data right now — try again in a bit.` }
  if (!matches.length) return { text: `No keybinds found matching "${arg}". Try a mod name, like "${p()} keybind vampirism".` }
  const lines = matches.map(k => `${k.key} — ${k.modName}: ${k.action}`)
  const suffix = matches.length === 8 ? `\n(showing first 8 — try a more specific search)` : ''
  return {
    text: lines.join('\n') + suffix,
    embed: { title: arg ? `Keybinds matching "${arg}"` : 'Keybinds', description: lines.join('\n') + suffix, color: 0x22d3ee, footer: { text: 'from options.txt · this modpack' } },
  }
}

async function cmdMap(rcon, arg) {
  const radiusArg = Number(arg)
  const radius = Number.isFinite(radiusArg) && radiusArg > 0 ? radiusArg : 1200

  const { names } = await listPlayers(rcon)
  const markers = []
  for (const name of names) {
    const pos = await getPos(rcon, name).catch(() => null)
    if (pos && (!pos.dim || pos.dim === 'minecraft:overworld')) markers.push(pos)
  }

  // Center on the average of online overworld players, or world spawn if
  // nobody's out there (or everyone's in another dimension).
  let centerX, centerZ
  if (markers.length) {
    centerX = markers.reduce((s, m) => s + m.x, 0) / markers.length
    centerZ = markers.reduce((s, m) => s + m.z, 0) / markers.length
  } else {
    try {
      const spawn = await readWorldSpawn(config.worldDir)
      centerX = spawn.x; centerZ = spawn.z
    } catch { centerX = 0; centerZ = 0 }
  }

  let rendered
  try {
    rendered = renderMap({ worldDir: config.worldDir, centerX, centerZ, radius, markers })
  } catch (err) {
    return { text: `Couldn't render the map: ${err.message}` }
  }
  return {
    text: `Overworld map, ${rendered.width}x${rendered.height} centered on ${Math.round(centerX)}, ${Math.round(centerZ)}` +
      `${markers.length ? ` (${markers.length} player marker${markers.length === 1 ? '' : 's'})` : ' (world spawn — nobody online)'}` +
      ' — posted in Fluxer.',
    files: [{ name: 'map.png', data: rendered.buffer, contentType: 'image/png' }],
  }
}

function cmdHelp() {
  const x = p()
  return {
    text: [
      `${x} status - server status (players, time, TPS, address, backend checks)`,
      `${x} list — online players`,
      `${x} stats [player] - playtime, deaths, kills, blocks mined, distance`,
      `${x} top [playtime|deaths|kills|mined|distance|pass] - leaderboards`,
      `${x} pass [player] - battlepass level and progress this season`,
      `${x} where <player> — position + dimension`,
      `${x} seed / time / tps — server info`,
      `${x} recipe <item> — crafting recipe (checks this modpack first, then vanilla)`,
      `${x} keybind <mod or action> — look up a keybind from this modpack`,
      `${x} map [radius] — render the overworld map around players (or spawn), default radius 1200 (admin only)`,
      `${x} restart — vote to restart the server (needs a majority of online players within 2 minutes, 1 hour cooldown after a restart; a 50/50 split gets settled with a d20 roll)`,
    ].join('\n'),
  }
}

function isAdmin(invoker) {
  return config.mapAdmins.has(String(invoker || '').toLowerCase())
}

export async function runCommand(parsed, rcon, invoker) {
  switch (parsed.cmd) {
    case 'help': return cmdHelp()
    case 'status': case 'online': return cmdStatus(rcon)
    case 'list': case 'players': case 'who': return cmdList(rcon)
    case 'stats': case 'stat': return cmdStats(parsed.arg, invoker)
    case 'top': case 'leaderboard': case 'lb': return cmdTop(parsed.arg)
    case 'pass': case 'battlepass': case 'bp': return cmdPass(parsed.arg, invoker)
    case 'where': case 'pos': case 'whereis': return cmdWhere(rcon, parsed.arg)
    case 'seed': return cmdSeed(rcon)
    case 'time': case 'weather': return cmdTime(rcon)
    case 'tps': case 'perf': return cmdTps(rcon)
    case 'recipe': case 'craft': case 'crafting': return cmdRecipe(parsed.arg)
    case 'keybind': case 'keybinds': case 'key': case 'keys': return cmdKeybind(parsed.arg)
    case 'map':
      if (!isAdmin(invoker)) return { text: `Only admins can run "${p()} map".` }
      return cmdMap(rcon, parsed.arg)
    case 'restart': case 'restartvote': case 'vote': return cmdRestartVote(rcon, invoker)
    default: return { text: `Unknown command "${parsed.cmd}". Try "${p()} help".` }
  }
}
