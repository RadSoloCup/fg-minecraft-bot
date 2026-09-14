// Vanilla recipe lookup, sourced from misode/mcmeta's generated data (mirrors
// the latest release's `data/minecraft/recipe/*.json`). Modded items aren't
// covered — this pack has thousands of them with no equivalent public data
// source, so recipe lookup is vanilla-only by design.
const BASE = 'https://raw.githubusercontent.com/misode/mcmeta/data/data/minecraft/recipe'

const cache = new Map() // id -> { json|null, at }
const CACHE_MS = 60 * 60 * 1000

function normalizeId(input) {
  return input.trim().toLowerCase().replace(/\s+/g, '_').replace(/^minecraft:/, '')
}

async function fetchRecipeJson(id) {
  const cached = cache.get(id)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.json
  let json = null
  try {
    const res = await fetch(`${BASE}/${id}.json`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) json = await res.json()
  } catch { /* treat as not found */ }
  cache.set(id, { json, at: Date.now() })
  return json
}

// Strips any "namespace:" prefix (not just vanilla's) so modded items read
// naturally too — "soulwood planks", not "malum:soulwood planks". Which mod
// an item belongs to is still shown separately, in the embed footer.
const itemLabel = id => String(id).replace(/^[a-z0-9_.-]+:/, '').replace(/_/g, ' ')
const tagLabel = id => '#' + String(id).replace(/^[a-z0-9_.-]+:/, '').replace(/_/g, ' ')

function ingredientLabel(v) {
  if (v == null) return '?'
  if (typeof v === 'string') return v.startsWith('#') ? tagLabel(v.slice(1)) : itemLabel(v)
  if (Array.isArray(v)) return [...new Set(v.map(ingredientLabel))].join(' / ')
  if (v.item) return itemLabel(v.item)
  if (v.tag) return tagLabel(v.tag)
  return '?'
}

function resultLabel(r) {
  if (!r) return '?'
  const id = r.id || r.item
  const count = r.count && r.count > 1 ? ` x${r.count}` : ''
  return id ? itemLabel(id) + count : '?'
}

// Returns { title, lines[] } for a chat-friendly rendering, or null if the
// recipe type isn't one we know how to render (still shown raw as a fallback).
// Exported so moddata.js can reuse it for this pack's own recipes — the JSON
// shape (type/pattern/key/ingredients/result) is the same convention modded
// recipes use, not something specific to vanilla.
export function formatRecipe(id, r) {
  // The recipe id and its result are usually the same item (id is often
  // literally the result's item id) — only show both when they actually
  // differ, e.g. a smithing recipe id vs. its upgraded result.
  const idLabel = itemLabel(id)
  const resLabel = resultLabel(r.result)
  const resLabelNoCount = resLabel.replace(/ x\d+$/, '')
  const title = resLabelNoCount === idLabel ? resLabel : `${idLabel} — ${resLabel}`
  const type = (r.type || '').replace(/^minecraft:/, '')

  if (type === 'crafting_shaped') {
    const key = r.key || {}
    const pattern = r.pattern || []
    const rows = pattern.map(row =>
      [...row].map(ch => (ch === ' ' ? '·' : ch)).join(' '))
    const legend = Object.entries(key).map(([k, v]) => `${k} = ${ingredientLabel(v)}`)
    return { title, lines: [...rows, '', ...legend] }
  }
  if (type === 'crafting_shapeless') {
    const ingredients = (r.ingredients || []).map(ingredientLabel)
    return { title, lines: ingredients.map(i => `• ${i}`) }
  }
  if (['smelting', 'blasting', 'smoking', 'campfire_cooking'].includes(type)) {
    const time = r.cookingtime ? `${r.cookingtime} ticks` : null
    const xp = r.experience ? `${r.experience} XP` : null
    return {
      title,
      lines: [`Smelt: ${ingredientLabel(r.ingredient)}`, [time, xp].filter(Boolean).join(' · ')].filter(Boolean),
    }
  }
  if (type === 'stonecutting') {
    return { title, lines: [`Stonecutter: ${ingredientLabel(r.ingredient)}`] }
  }
  if (type === 'smithing_transform' || type === 'smithing_trim') {
    return {
      title,
      lines: [
        `Base: ${ingredientLabel(r.base)}`,
        `Addition: ${ingredientLabel(r.addition)}`,
        r.template ? `Template: ${ingredientLabel(r.template)}` : null,
      ].filter(Boolean),
    }
  }
  return null
}

// Returns null if no vanilla recipe exists by that id.
export async function findRecipe(input) {
  const id = normalizeId(input)
  const json = await fetchRecipeJson(id)
  if (!json) return null
  const formatted = formatRecipe(id, json)
  return formatted || { title: itemLabel(id), lines: [`(unrecognized recipe type: ${json.type})`] }
}
