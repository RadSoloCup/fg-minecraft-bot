import { config } from './config.js'

export function log(...a) {
  console.log(new Date().toISOString(), ...a)
}

// Discord-wire-compatible webhook payload: { content?, username?, avatar_url? }.
export async function postWebhook(payload) {
  const res = await fetch(config.fluxer.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': config.userAgent },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`POST webhook → ${res.status} ${body.slice(0, 200)}`)
  }
}
