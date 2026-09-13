import { Socket } from 'node:net'
import { log } from './lib.js'

// Minimal Source RCON client (the protocol Minecraft's RCON speaks).
// SERVERDATA_AUTH = 3, SERVERDATA_AUTH_RESPONSE = 2, SERVERDATA_EXECCOMMAND = 2,
// SERVERDATA_RESPONSE_VALUE = 0. Auth and exec share type 2 but never collide
// here since exec is only ever sent after auth has resolved.
const AUTH = 3
const AUTH_RESPONSE = 2
const EXEC = 2

function encode(id, type, body) {
  const bodyBuf = Buffer.from(body + '\0\0', 'utf8')
  const payloadLen = 4 + 4 + bodyBuf.length
  const buf = Buffer.alloc(4 + payloadLen)
  buf.writeInt32LE(payloadLen, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  bodyBuf.copy(buf, 12)
  return buf
}

export class RconClient {
  constructor({ host, port, password }) {
    this.host = host
    this.port = port
    this.password = password
    this.socket = null
    this.authed = false
    this.nextId = 1
    this.pending = new Map() // id -> {resolve, reject}
    this.authWait = null
    this.buf = Buffer.alloc(0)
    this._connecting = null
  }

  ensureConnected() {
    if (this.authed && this.socket && !this.socket.destroyed) return Promise.resolve()
    return this._connect()
  }

  _connect() {
    if (this._connecting) return this._connecting
    this._connecting = new Promise((resolve, reject) => {
      const sock = new Socket()
      this.socket = sock
      this.buf = Buffer.alloc(0)
      let settled = false
      const fail = err => { if (!settled) { settled = true; reject(err) } }

      sock.on('data', chunk => this._onData(chunk))
      sock.on('error', fail)
      sock.on('close', () => {
        this.authed = false
        this._connecting = null
        fail(new Error('RCON connection closed before auth completed'))
        for (const { reject: rj } of this.pending.values()) rj(new Error('RCON connection closed'))
        this.pending.clear()
      })
      sock.connect(this.port, this.host, () => {
        const id = this.nextId++
        this.authWait = {
          resolve: () => { settled = true; resolve() },
          reject: fail,
        }
        sock.write(encode(id, AUTH, this.password))
      })
    })
    return this._connecting
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0)
      if (this.buf.length < 4 + len) break
      const packet = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      const id = packet.readInt32LE(0)
      const type = packet.readInt32LE(4)
      const body = packet.subarray(8, packet.length - 2).toString('utf8')

      if (this.authWait && type === AUTH_RESPONSE) {
        const { resolve, reject } = this.authWait
        this.authWait = null
        if (id === -1) reject(new Error('RCON authentication failed (bad password)'))
        else { this.authed = true; resolve() }
        continue
      }
      const p = this.pending.get(id)
      if (p) { this.pending.delete(id); p.resolve(body) }
    }
  }

  async exec(command) {
    await this.ensureConnected()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('RCON command timed out'))
      }, 10_000)
      this.pending.set(id, {
        resolve: body => { clearTimeout(timer); resolve(body) },
        reject: err => { clearTimeout(timer); reject(err) },
      })
      this.socket.write(encode(id, EXEC, command))
    })
  }

  close() {
    try { this.socket?.destroy() } catch {}
  }
}

export function tellrawAll(rcon, textComponent) {
  return rcon.exec(`tellraw @a ${JSON.stringify(textComponent)}`)
    .catch(err => log('rcon: tellraw failed:', err.message))
}
