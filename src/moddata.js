// Pack-specific data: keybinds and recipes for the actual mods installed,
// not just vanilla. Both are generated from the real modpack (mods.toml
// metadata, options.txt, and each mod's own recipe JSON) and published by
// the Portal at /minecraft/mods-assets/ — this module just fetches and
// caches them from there rather than bundling a copy here, so the bot always
// reflects whatever the Portal is currently serving with no separate build
// step of its own.
import { formatRecipe } from './mcdata.js'

const BASE = process.env.PACK_DATA_BASE || 'https://fightersguild.playit.quest/minecraft/mods-assets'
const CACHE_MS = 60 * 60 * 1000

const cache = new Map() // url -> { data, at }

async function fetchJson(url) {
  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  const data = await res.json()
  cache.set(url, { data, at: Date.now() })
  return data
}

const getRecipes = () => fetchJson(`${BASE}/recipes-index.json`)
const getKeybinds = () => fetchJson(`${BASE}/keybinds.json`)

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s_-]+/g, '_')
}

const itemLabel = id => String(id).split(':').pop().replace(/_/g, ' ')

// Looks up an item by name across every mod's recipe data (plus vanilla,
// since the pack's own data also carries some vanilla-namespaced additions).
// Matches on the item id's name part, ignoring which mod it belongs to,
// unless the query itself includes a "modid:" prefix. Returns
// { title, lines[], modId } or null if nothing in the pack makes that item.
export async function findModdedRecipe(query) {
  const recipes = await getRecipes()
  const q = normalize(query)

  let candidateKeys
  if (query.includes(':')) {
    candidateKeys = Object.keys(recipes).filter(k => normalize(k) === q)
  } else {
    candidateKeys = Object.keys(recipes).filter(k => normalize(k.split(':')[1] || '') === q)
    if (!candidateKeys.length) {
      // fall back to substring match so "soulwood plank" still finds
      // "malum:soulwood_planks"
      candidateKeys = Object.keys(recipes).filter(k => normalize(k.split(':')[1] || '').includes(q))
    }
  }
  if (!candidateKeys.length) return null

  const key = candidateKeys[0]
  const [modId] = key.split(':')
  const list = recipes[key]
  const r = list[0]
  const formatted = formatRecipe(key, r)
  const extra = list.length > 1 ? [`(+${list.length - 1} more way${list.length - 1 === 1 ? '' : 's'} to get this)`] : []
  const ambiguous = candidateKeys.length > 1
    ? [`Matched ${itemLabel(key)} (${modId}) — also found: ${candidateKeys.slice(1, 4).map(k => itemLabel(k)).join(', ')}${candidateKeys.length > 4 ? ', …' : ''}`]
    : []
  return formatted
    ? { title: formatted.title, lines: [...formatted.lines, ...extra, ...ambiguous], modId }
    : { title: itemLabel(key), lines: [`(unrecognized recipe type: ${r.type})`, ...extra, ...ambiguous], modId }
}

// Matches a keybind by mod name, action, or key — whatever the query looks
// like. Returns up to `limit` rows: { modName, action, key }.
export async function findKeybinds(query, limit = 8) {
  const keybinds = await getKeybinds()
  const q = String(query || '').trim().toLowerCase()
  if (!q) return keybinds.slice(0, limit)
  return keybinds.filter(k =>
    (k.modName && k.modName.toLowerCase().includes(q)) ||
    (k.action && k.action.toLowerCase().includes(q)) ||
    (k.key && k.key.toLowerCase().includes(q))
  ).slice(0, limit)
}
