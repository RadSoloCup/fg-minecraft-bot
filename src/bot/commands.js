import { config } from '../config.js'
import { findRecipe } from '../mcdata.js'
import { findModdedRecipe, findKeybinds } from '../moddata.js'
import { renderMap, readWorldSpawn } from '../worldmap.js'

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
  const [dayOut, dayTimeOut] = await Promise.all([
    rcon.exec('time query day'),
    rcon.exec('time query daytime'),
  ])
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
      `${x} list — online players`,
      `${x} where <player> — position + dimension`,
      `${x} seed / time / tps — server info`,
      `${x} recipe <item> — crafting recipe (checks this modpack first, then vanilla)`,
      `${x} keybind <mod or action> — look up a keybind from this modpack`,
      `${x} map [radius] — render the overworld map around players (or spawn), default radius 1200 (admin only)`,
    ].join('\n'),
  }
}

function isAdmin(invoker) {
  return config.mapAdmins.has(String(invoker || '').toLowerCase())
}

export async function runCommand(parsed, rcon, invoker) {
  switch (parsed.cmd) {
    case 'help': return cmdHelp()
    case 'list': case 'players': case 'who': return cmdList(rcon)
    case 'where': case 'pos': case 'whereis': return cmdWhere(rcon, parsed.arg)
    case 'seed': return cmdSeed(rcon)
    case 'time': case 'weather': return cmdTime(rcon)
    case 'tps': case 'perf': return cmdTps(rcon)
    case 'recipe': case 'craft': case 'crafting': return cmdRecipe(parsed.arg)
    case 'keybind': case 'keybinds': case 'key': case 'keys': return cmdKeybind(parsed.arg)
    case 'map':
      if (!isAdmin(invoker)) return { text: `Only admins can run "${p()} map".` }
      return cmdMap(rcon, parsed.arg)
    default: return { text: `Unknown command "${parsed.cmd}". Try "${p()} help".` }
  }
}
