import { Socket } from 'node:net'
import { stat } from 'node:fs/promises'
import { config } from './config.js'

// Backend checks for `!mc status`, shown as a checklist like the Portal's
// status board.

let gateway = null
export function setGateway(gw) { gateway = gw }

function varint(n) {
  const out = []
  do {
    let b = n & 0x7f
    n >>>= 7
    if (n) b |= 0x80
    out.push(b)
  } while (n)
  return Buffer.from(out)
}

function readVarint(buf, offset) {
  let value = 0, shift = 0, pos = offset
  while (pos < buf.length) {
    const b = buf[pos++]
    value |= (b & 0x7f) << shift
    if (!(b & 0x80)) return { value, next: pos }
    shift += 7
    if (shift > 35) throw new Error('bad varint')
  }
  return null // need more bytes
}

function packet(id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts])
  return Buffer.concat([varint(body.length), body])
}

// Minecraft Server List Ping through the public address, so a pass proves the
// playit tunnel and the server's login listener are both working end to end.
export function pingServer(address, timeoutMs = 5000) {
  const [host, portStr] = address.split(':')
  const port = Number(portStr || 25565)
  return new Promise(resolve => {
    const started = Date.now()
    const sock = new Socket()
    let buf = Buffer.alloc(0)
    const done = result => { sock.destroy(); resolve(result) }
    sock.setTimeout(timeoutMs, () => done({ ok: false, detail: 'timed out' }))
    sock.on('error', err => done({ ok: false, detail: err.code || err.message }))
    sock.connect(port, host, () => {
      const hostBuf = Buffer.from(host, 'utf8')
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port)
      sock.write(packet(0x00, varint(763), varint(hostBuf.length), hostBuf, portBuf, varint(1)))
      sock.write(packet(0x00))
    })
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      try {
        const len = readVarint(buf, 0)
        if (!len || buf.length < len.next + len.value) return
        const id = readVarint(buf, len.next)
        const strLen = readVarint(buf, id.next)
        const json = JSON.parse(buf.subarray(strLen.next, strLen.next + strLen.value).toString('utf8'))
        done({ ok: true, ms: Date.now() - started, version: json.version?.name })
      } catch (err) {
        done({ ok: false, detail: `bad response (${err.message})` })
      }
    })
  })
}

export async function backendChecks({ rconOk }) {
  const checks = [{ label: 'Game server', ok: rconOk, detail: rconOk ? null : 'RCON unreachable' }]

  if (config.serverAddress) {
    const ping = await pingServer(config.serverAddress)
    checks.push({ label: 'Public address', ok: ping.ok, detail: ping.ok ? `${ping.ms} ms` : ping.detail })
  }

  const logOk = await stat(config.logPath).then(() => true, () => false)
  checks.push({ label: 'Chat bridge', ok: logOk, detail: logOk ? null : 'server log not readable' })

  if (gateway) {
    const up = gateway.ws?.readyState === 1 && !!gateway.botUserId
    checks.push({ label: 'Fluxer bot', ok: up, detail: up ? null : 'gateway disconnected' })
  }
  return checks
}
