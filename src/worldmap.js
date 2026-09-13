import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { inflateSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import * as nbt from 'prismarine-nbt'
import { PNG } from 'pngjs'
import { blockColor } from './blockColors.js'

// Renders a top-down PNG of the currently-generated overworld region files by
// reading the raw .mca files directly — no server mod required. Only correct
// for the modern (1.18+) chunk format: world Y range -64..320, non-padded
// bit-packed sections (DataVersion >= 2529-ish).
const REGION_CHUNKS = 32
const CHUNK_BLOCKS = 16
const REGION_PX = REGION_CHUNKS * CHUNK_BLOCKS // 512
const MIN_Y = -64
const MAX_IMAGE_DIM = 4096

function longsFromPairs(pairs) {
  return pairs.map(([hi, lo]) => (BigInt.asUintN(32, BigInt(hi)) << 32n) | BigInt.asUintN(32, BigInt(lo)))
}

function unpackLongArray(pairs, bitsPerEntry, count) {
  const longs = longsFromPairs(pairs)
  const valuesPerLong = Math.floor(64 / bitsPerEntry)
  const mask = (1n << BigInt(bitsPerEntry)) - 1n
  const out = new Array(count)
  for (let i = 0; i < count; i++) {
    const longIdx = Math.floor(i / valuesPerLong)
    const bitOffset = BigInt((i % valuesPerLong) * bitsPerEntry)
    out[i] = Number((longs[longIdx] >> bitOffset) & mask)
  }
  return out
}

function readChunk(regionBuf, sectorOffset) {
  const start = sectorOffset * 4096
  if (start + 5 > regionBuf.length) return null
  const length = regionBuf.readUInt32BE(start)
  const compression = regionBuf[start + 4]
  const payload = regionBuf.subarray(start + 5, start + 5 + length - 1)
  let raw
  if (compression === 1) raw = gunzipSync(payload)
  else if (compression === 2) raw = inflateSync(payload)
  else if (compression === 3) raw = payload
  else return null
  const root = nbt.parseUncompressed(raw, 'big')
  return nbt.simplify(root)
}

function setPixel(png, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return
  const idx = (png.width * y + x) << 2
  png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = a
}

function renderChunk(png, chunk, baseX, baseZ) {
  const sectionsByY = new Map()
  for (const s of chunk.sections || []) sectionsByY.set(s.Y, s)

  const hmPairs = chunk.Heightmaps?.MOTION_BLOCKING
  if (!hmPairs) return
  const heights = unpackLongArray(hmPairs, 9, 256)
  const sectionCache = new Map() // sectionY -> 4096-entry palette-index array

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const stored = heights[z * 16 + x]
      if (!stored) continue // column has no blocking block yet (unexplored)
      const worldY = stored + MIN_Y - 1
      const sy = Math.floor(worldY / 16)
      const section = sectionsByY.get(sy)
      const palette = section?.block_states?.palette
      if (!palette?.length) continue

      let name
      if (palette.length === 1) {
        name = palette[0].Name
      } else {
        let decoded = sectionCache.get(sy)
        if (!decoded) {
          const bitsPerEntry = Math.max(4, Math.ceil(Math.log2(palette.length)))
          decoded = unpackLongArray(section.block_states.data, bitsPerEntry, 4096)
          sectionCache.set(sy, decoded)
        }
        const ly = worldY - sy * 16
        const idx = ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15)
        name = palette[decoded[idx]]?.Name
      }
      if (!name || name.endsWith('air')) continue
      const [r, g, b] = blockColor(name)
      setPixel(png, baseX + x, baseZ + z, r, g, b, 255)
    }
  }
}

function drawMarker(png, x, z) {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2
      setPixel(png, x + dx, z + dz, 255, 20, 60, edge ? 255 : 200)
    }
  }
}

// Reads the world's spawn point out of level.dat (gzip-compressed NBT).
export async function readWorldSpawn(worldDir) {
  const buf = readFileSync(join(worldDir, 'level.dat'))
  const { parsed } = await nbt.parse(buf)
  const d = nbt.simplify(parsed).Data
  return { x: d?.SpawnX ?? 0, z: d?.SpawnZ ?? 0 }
}

// Renders a `radius`-block square centered on (centerX, centerZ) — NOT the
// whole world. This save has 3000+ region files spanning ~63000x57000
// blocks (years of FTB Chunks-loaded exploration); rendering that fully
// would mean reading gigabytes of region data for an image nobody could
// usefully view. A bounded area around spawn/players is what's actually
// useful, and only the handful of region files it touches get read.
// markers: [{ x, z }] in world block coordinates (overworld only).
export function renderMap({ worldDir, centerX = 0, centerZ = 0, radius = 600, markers = [] }) {
  const regionDir = join(worldDir, 'region')
  if (!existsSync(regionDir)) throw new Error(`no region directory at ${regionDir}`)

  radius = Math.min(Math.max(Math.round(radius), 64), Math.floor(MAX_IMAGE_DIM / 2))
  const minX = Math.round(centerX) - radius
  const minZ = Math.round(centerZ) - radius
  const width = radius * 2
  const height = radius * 2

  const minRX = Math.floor(minX / REGION_PX)
  const maxRX = Math.floor((minX + width - 1) / REGION_PX)
  const minRZ = Math.floor(minZ / REGION_PX)
  const maxRZ = Math.floor((minZ + height - 1) / REGION_PX)

  const png = new PNG({ width, height })
  png.data.fill(0)

  for (let rx = minRX; rx <= maxRX; rx++) {
    for (let rz = minRZ; rz <= maxRZ; rz++) {
      const file = join(regionDir, `r.${rx}.${rz}.mca`)
      if (!existsSync(file)) continue
      let buf
      try { buf = readFileSync(file) } catch { continue }
      if (buf.length < 8192) continue

      for (let cz = 0; cz < REGION_CHUNKS; cz++) {
        for (let cx = 0; cx < REGION_CHUNKS; cx++) {
          const chunkWorldX = rx * REGION_PX + cx * CHUNK_BLOCKS
          const chunkWorldZ = rz * REGION_PX + cz * CHUNK_BLOCKS
          // skip chunks entirely outside the requested square
          if (chunkWorldX + CHUNK_BLOCKS <= minX || chunkWorldX >= minX + width) continue
          if (chunkWorldZ + CHUNK_BLOCKS <= minZ || chunkWorldZ >= minZ + height) continue

          const i = cx + cz * REGION_CHUNKS
          const v = buf.readUInt32BE(i * 4)
          const off = v >>> 8
          if (!off) continue
          let chunk
          try { chunk = readChunk(buf, off) } catch { continue }
          if (!chunk) continue
          renderChunk(png, chunk, chunkWorldX - minX, chunkWorldZ - minZ)
        }
      }
    }
  }

  for (const m of markers) {
    drawMarker(png, Math.round(m.x) - minX, Math.round(m.z) - minZ)
  }

  return { buffer: PNG.sync.write(png), width, height, minX, minZ }
}
