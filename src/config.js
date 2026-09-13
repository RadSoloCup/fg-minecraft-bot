const env = process.env

export const config = {
  logPath: env.MC_LOG_PATH || '/mc-logs/latest.log',
  worldDir: env.WORLD_DIR || '/world',
  commandPrefix: env.COMMAND_PREFIX || '!mc',
  // Names allowed to run admin-only commands (currently just `map`), matched
  // case-insensitively against either the Minecraft player name or the
  // Fluxer/Discord display name — whichever surface the command came from.
  mapAdmins: new Set(String(env.ADMIN_NAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),

  rcon: {
    host: env.RCON_HOST || 'FTB-Direwolf20-1.20',
    port: Number(env.RCON_PORT || 25575),
    password: env.RCON_PASSWORD || '',
  },

  fluxer: {
    webhookUrl: env.FLUXER_WEBHOOK_URL || null,
    // Parsed from .../api/webhooks/<id>/<token> — lets the gateway ignore only
    // this bridge's own echo, without blanket-filtering every webhook message
    // (Crosstalk relays real Discord users through its own webhook, and those
    // need to reach the command handler / MC relay).
    ownWebhookId: env.FLUXER_WEBHOOK_URL ? (env.FLUXER_WEBHOOK_URL.match(/\/webhooks\/(\d+)\//) || [])[1] || null : null,
    channelId: env.FLUXER_CHANNEL_ID || null,
    botToken: env.FLUXER_BOT_TOKEN || null,
    apiBase: env.FLUXER_API_BASE || (env.FLUXER_WEBHOOK_URL ? new URL(env.FLUXER_WEBHOOK_URL).origin : null),
  },

  userAgent: env.USER_AGENT || 'fightersguild-mc-bridge',
}

export function assertConfig() {
  if (!config.fluxer.webhookUrl) {
    throw new Error('FLUXER_WEBHOOK_URL is required (MC chat -> Fluxer)')
  }
  if (config.fluxer.botToken && !config.fluxer.channelId) {
    throw new Error('FLUXER_CHANNEL_ID is required alongside FLUXER_BOT_TOKEN (Fluxer -> MC)')
  }
  if (config.fluxer.botToken && !config.rcon.password) {
    throw new Error('RCON_PASSWORD is required to relay Fluxer chat into the game')
  }
}
