import { config } from '../config.js'
import { log } from '../lib.js'

function authHeaders() {
  return {
    authorization: `Bot ${config.fluxer.botToken}`,
    'user-agent': config.userAgent,
  }
}

async function req(method, path, body) {
  const url = `${config.fluxer.apiBase}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(),
      ...(body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status} ${t.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

// Discord-wire-compatible gateway bootstrap. Returns { url, shards, ... }.
export async function getBotGateway() {
  return req('GET', '/gateway/bot')
}

export { log }
