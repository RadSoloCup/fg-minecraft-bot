import { config } from './config.js'

export function log(...a) {
  console.log(new Date().toISOString(), ...a)
}

// Discord-wire-compatible webhook payload: { content?, username?, avatar_url?, embeds? }.
// `files`, if given, is [{ name, data: Buffer, contentType }] — sent as
// multipart/form-data alongside a `payload_json` field, same as Discord.
export async function postWebhook(payload, files) {
  let body, headers
  if (files?.length) {
    const form = new FormData()
    form.set('payload_json', JSON.stringify(payload))
    files.forEach((f, i) => form.set(`files[${i}]`, new Blob([f.data], { type: f.contentType }), f.name))
    body = form
    headers = { 'user-agent': config.userAgent }
  } else {
    body = JSON.stringify(payload)
    headers = { 'content-type': 'application/json', 'user-agent': config.userAgent }
  }
  const res = await fetch(config.fluxer.webhookUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`POST webhook → ${res.status} ${t.slice(0, 200)}`)
  }
}
