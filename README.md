# fightersguild-mc-bridge

Bidirectional chat bridge between the Fighters Guild Minecraft server
(`FTB-Direwolf20-1.20`, a modded Forge server on Docker) and a Fluxer channel.
No plugin/mod needed on the Minecraft side — it works by tailing the
server's log file and talking RCON.

- **Minecraft -> Fluxer**: tails `logs/latest.log` for chat lines
  (`<player> message`) and join/leave events, posts them to a Fluxer channel
  via webhook (chat messages appear under the player's own name + head icon).
- **Fluxer -> Minecraft** *(optional)*: a small bot listens on one Fluxer
  channel and relays messages into the game with `tellraw @a` over RCON.
  Skipped entirely if `FLUXER_BOT_TOKEN` isn't set — the MC -> Fluxer
  direction still works on its own.

## Deploy (Unraid / Docker Compose)

1. Copy `.env.example` to `mc-bridge.env` and fill in the webhook URL (and,
   for the reverse direction, the bot token + channel id + RCON password).
2. Make sure the Minecraft container and this one share a Docker network so
   RCON traffic never has to touch the host or LAN:
   ```
   docker network create mc-net
   docker network connect mc-net FTB-Direwolf20-1.20
   ```
3. Enable RCON in the Minecraft server's `server.properties`
   (`enable-rcon=true`, `rcon.password=...`) and restart that container.
4. Put `compose.snippet.yml` (renamed `docker-compose.yml`) + `mc-bridge.env`
   in `/boot/config/plugins/compose.manager/projects/mc-bridge/` and run
   `docker compose up -d --build` — it builds straight from this GitHub repo,
   no local checkout needed.

The bridge only needs outbound access to Fluxer and RCON access to the
Minecraft container on `mc-net` — no ports of its own.

## Credits

| Project | Used for | License |
| --- | --- | --- |
| [**Fluxer**](https://github.com/fluxerapp/fluxer) | the chat platform, gateway and webhook protocol | AGPL-3.0 |

## License

Copyright &copy; 2026 Fighters Guild. Licensed under the
[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html), see [`LICENSE`](LICENSE).

Running a modified version as a network service obliges you to offer its
source to users (AGPL section 13).

---

Made in Canada 🇨🇦
