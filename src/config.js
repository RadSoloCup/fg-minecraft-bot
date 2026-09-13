const env = process.env

export const config = {
  logPath: env.MC_LOG_PATH || '/mc-logs/latest.log',

  rcon: {
    host: env.RCON_HOST || 'FTB-Direwolf20-1.20',
    port: Number(env.RCON_PORT || 25575),
    password: env.RCON_PASSWORD || '',
  },

  fluxer: {
    webhookUrl: env.FLUXER_WEBHOOK_URL || null,
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
