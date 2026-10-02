import { readFile, readdir } from 'node:fs/promises'
import nbt from 'prismarine-nbt'
import { config } from './config.js'

// Player stats (world/stats/<uuid>.json) and battlepass progress
// (world/playerdata/<uuid>.dat, KubeJSPersistentData.battlepass). Both are only
// written when the server saves (autosave every ~5 min, or on logout), so
// online players can be a few minutes behind.

async function userCache() {
  const raw = await readFile(`${config.serverDir}/usercache.json`, 'utf8')
  const byUuid = new Map()
  for (const u of JSON.parse(raw)) byUuid.set(u.uuid, u.name)
  return byUuid
}

async function resolvePlayer(name) {
  const cache = await userCache()
  const wanted = String(name).toLowerCase()
  for (const [uuid, n] of cache) if (n.toLowerCase() === wanted) return { uuid, name: n }
  return null
}

const sum = obj => Object.values(obj || {}).reduce((s, v) => s + (Number(v) || 0), 0)
const DISTANCE_KEYS = ['walk_one_cm', 'sprint_one_cm', 'crouch_one_cm', 'swim_one_cm', 'walk_on_water_one_cm',
  'walk_under_water_one_cm', 'climb_one_cm', 'fly_one_cm', 'aviate_one_cm', 'boat_one_cm', 'horse_one_cm',
  'minecart_one_cm', 'pig_one_cm', 'strider_one_cm']

function summarize(json) {
  const s = json.stats || {}
  const c = s['minecraft:custom'] || {}
  return {
    playtime: (c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? 0) / 20, // seconds
    deaths: c['minecraft:deaths'] || 0,
    kills: c['minecraft:mob_kills'] || 0,
    mined: sum(s['minecraft:mined']),
    distance: DISTANCE_KEYS.reduce((t, k) => t + (c[`minecraft:${k}`] || 0), 0) / 100_000, // km
  }
}

async function readStats(uuid) {
  try { return summarize(JSON.parse(await readFile(`${config.worldDir}/stats/${uuid}.json`, 'utf8'))) }
  catch { return null }
}

export async function playerStats(name) {
  const p = await resolvePlayer(name)
  if (!p) return null
  const stats = await readStats(p.uuid)
  return stats ? { name: p.name, ...stats } : null
}

export const METRICS = {
  playtime: { label: 'Playtime', fmt: v => formatDuration(v) },
  deaths: { label: 'Deaths', fmt: v => v.toLocaleString('en-US') },
  kills: { label: 'Mob kills', fmt: v => v.toLocaleString('en-US') },
  mined: { label: 'Blocks mined', fmt: v => v.toLocaleString('en-US') },
  distance: { label: 'Distance travelled', fmt: v => `${v.toFixed(1)} km` },
}

export async function leaderboard(metric, limit = 10) {
  const cache = await userCache()
  const files = (await readdir(`${config.worldDir}/stats`)).filter(f => f.endsWith('.json'))
  const rows = []
  for (const f of files) {
    const uuid = f.slice(0, -5)
    const name = cache.get(uuid)
    if (!name) continue
    const s = await readStats(uuid)
    if (s && s[metric] > 0) rows.push({ name, value: s[metric] })
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, limit)
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `${h}h ${m}m` : `${m}m`
}

// ── battlepass ───────────────────────────────────────────────────────────────

// The season config lives as a JSON object literal inside the deployed KubeJS
// script (KubeJS can't read files), so pull it out of there instead of keeping
// a second copy that could drift.
async function battlepassConfig() {
  const src = await readFile(`${config.serverDir}/kubejs/server_scripts/battlepass.js`, 'utf8')
  const start = src.indexOf('{', src.indexOf('var BP ='))
  let depth = 0, end = start
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++
    else if (src[end] === '}' && --depth === 0) break
  }
  return JSON.parse(src.slice(start, end + 1))
}

// Same rotation maths as bpCurrentSeason() in the KubeJS script.
function currentSeason(bp) {
  const anchor = new Date(bp.anchorDate + 'T00:00:00Z')
  const now = new Date()
  const months = (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth())
  const seasonNumber = Math.max(0, Math.floor(months / 3))
  const addMonths = (d, n) => { const r = new Date(d.getTime()); r.setMonth(r.getMonth() + n); return r }
  return {
    key: 'S' + seasonNumber,
    name: bp.seasons[seasonNumber % bp.seasons.length].name,
    endDate: addMonths(anchor, (seasonNumber + 1) * 3),
  }
}

async function readBattlepass(uuid) {
  try {
    const { parsed } = await nbt.parse(await readFile(`${config.worldDir}/playerdata/${uuid}.dat`))
    return nbt.simplify(parsed).KubeJSPersistentData?.battlepass || null
  } catch { return null }
}

function passProgress(bp, season, state) {
  const current = state && state.seasonKey === season.key
  const xp = current ? state.seasonXp : 0
  const level = current ? state.level : 0
  return {
    level,
    maxLevel: bp.levelsPerSeason,
    xpIntoLevel: level >= bp.levelsPerSeason ? bp.xpPerLevel : xp - level * bp.xpPerLevel,
    xpPerLevel: bp.xpPerLevel,
    seasonXp: xp,
  }
}

export async function playerPass(name) {
  const p = await resolvePlayer(name)
  if (!p) return null
  const bp = await battlepassConfig()
  const season = currentSeason(bp)
  return { name: p.name, season, ...passProgress(bp, season, await readBattlepass(p.uuid)) }
}

export async function passLeaderboard(limit = 10) {
  const bp = await battlepassConfig()
  const season = currentSeason(bp)
  const rows = []
  for (const [uuid, name] of await userCache()) {
    const prog = passProgress(bp, season, await readBattlepass(uuid))
    if (prog.seasonXp > 0) rows.push({ name, ...prog })
  }
  return { season, rows: rows.sort((a, b) => b.seasonXp - a.seasonXp).slice(0, limit) }
}
