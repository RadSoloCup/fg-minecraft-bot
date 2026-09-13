import { EventEmitter } from 'node:events'
import { config } from '../config.js'
import { log } from '../lib.js'
import { getBotGateway } from './api.js'

// Fluxer gateway opcodes (Discord-compatible; from fluxer_gateway constants.erl)
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
}

export class GatewayClient extends EventEmitter {
  constructor() {
    super()
    this.ws = null
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.heartbeatTimer = null
    this.awaitingAck = false
    this.reconnectDelay = 1000
    this.botUserId = null
    this.closed = false
  }

  async start() {
    this.closed = false
    await this._connect()
  }

  stop() {
    this.closed = true
    this._clearHeartbeat()
    try { this.ws?.close(1000) } catch {}
  }

  async _connect(resume = false) {
    let base
    try {
      base = resume && this.resumeUrl ? this.resumeUrl : (await getBotGateway()).url
    } catch (err) {
      log(`bot: gateway lookup failed (${err.message}); retrying in 15s`)
      return void setTimeout(() => this._connect(), 15_000)
    }
    const url = `${base}${base.includes('?') ? '&' : '?'}v=1&encoding=json`
    log(`bot: connecting ${resume ? '(resume) ' : ''}${base}`)

    const ws = new WebSocket(url)
    this.ws = ws

    ws.addEventListener('message', ev => this._onMessage(ev.data, resume))
    ws.addEventListener('error', () => {}) // 'close' handles recovery
    ws.addEventListener('close', ev => {
      this._clearHeartbeat()
      if (this.closed) return
      // 4004 = auth failed, 4010/4011/4012 = fatal config — don't hammer
      const fatal = [4004, 4010, 4011, 4012, 4013].includes(ev.code)
      log(`bot: socket closed (${ev.code} ${ev.reason || ''})${fatal ? ' — FATAL, not reconnecting' : ''}`)
      if (fatal) { this.emit('fatal', ev.code); return }
      const delay = Math.min(this.reconnectDelay, 30_000)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      setTimeout(() => this._connect(!!this.sessionId), delay + Math.random() * 500)
    })
  }

  _onMessage(raw, wasResume) {
    let msg
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) } catch { return }
    if (msg.s != null) this.seq = msg.s

    switch (msg.op) {
      case OP.HELLO:
        this._startHeartbeat(msg.d.heartbeat_interval)
        if (wasResume && this.sessionId) this._send(OP.RESUME, {
          token: config.fluxer.botToken, session_id: this.sessionId, seq: this.seq,
        })
        else this._identify()
        break

      case OP.HEARTBEAT:
        this._send(OP.HEARTBEAT, this.seq)
        break

      case OP.HEARTBEAT_ACK:
        this.awaitingAck = false
        break

      case OP.INVALID_SESSION:
        log('bot: invalid session, re-identifying')
        this.sessionId = null
        setTimeout(() => this._identify(), 1500 + Math.random() * 3000)
        break

      case OP.RECONNECT:
        log('bot: server asked to reconnect')
        try { this.ws.close(4900) } catch {}
        break

      case OP.DISPATCH:
        this._onDispatch(msg.t, msg.d)
        break
    }
  }

  _onDispatch(type, d) {
    if (type === 'READY') {
      this.reconnectDelay = 1000
      this.sessionId = d.session_id || this.sessionId
      this.resumeUrl = d.resume_gateway_url || this.resumeUrl
      this.botUserId = d.user?.id ?? this.botUserId
      log(`bot: READY as ${d.user?.username ?? '?'} (${this.botUserId})`)
      this.emit('ready', d)
      return
    }
    if (type === 'RESUMED') { log('bot: resumed'); return }
    if (type === 'MESSAGE_CREATE') {
      if (d.author?.id && d.author.id === this.botUserId) return // ignore self
      // Ignore only OUR OWN webhook's messages (this bridge's MC->Fluxer relay
      // echoing back) — not webhooks in general, since Crosstalk relays real
      // Discord users through its own webhook and those should still reach us.
      if (d.webhook_id && d.webhook_id === config.fluxer.ownWebhookId) return
      if (d.author?.bot && !d.webhook_id) return // real bot accounts, not webhook-authored humans
      this.emit('message', d)
    }
  }

  _identify() {
    this._send(OP.IDENTIFY, {
      token: config.fluxer.botToken,
      properties: { os: process.platform, browser: 'fightersguild-mc-bridge', device: 'fightersguild-mc-bridge' },
      ignored_events: [
        'PRESENCE_UPDATE', 'TYPING_START', 'VOICE_STATE_UPDATE',
        'GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'GUILD_MEMBER_REMOVE',
        'CHANNEL_PINS_UPDATE', 'MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE',
      ],
    })
  }

  _startHeartbeat(interval) {
    this._clearHeartbeat()
    const jitter = Math.random()
    setTimeout(() => {
      this._beat()
      this.heartbeatTimer = setInterval(() => this._beat(), interval)
    }, interval * jitter)
  }

  _beat() {
    if (this.awaitingAck) {
      log('bot: missed heartbeat ack, cycling socket')
      try { this.ws.close(4900) } catch {}
      return
    }
    this.awaitingAck = true
    this._send(OP.HEARTBEAT, this.seq)
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.awaitingAck = false
  }

  _send(op, d) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op, d }))
      }
    } catch (err) {
      log(`bot: send failed (op ${op}): ${err.message}`)
    }
  }
}
