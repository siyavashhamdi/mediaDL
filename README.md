# Media Downloader

Personal **YouTube and Instagram** media downloader (TypeScript + Node.js). Includes a Telegram bot and a CLI.

Uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) under the hood. On first run, the standalone `yt-dlp` binary is downloaded into `./bin/` (no Python required).

## Supported links

| Platform | Content |
|----------|---------|
| YouTube | Videos, Shorts, live streams |
| Instagram | Public posts, reels, and stories |

The bot detects the platform from the link automatically.

## Requirements

- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) (recommended for merging video + audio)

Install ffmpeg on macOS:

```bash
brew install ffmpeg
```

## Setup

```bash
npm install
cp .env.example .env
```

Add your Telegram bot token to `.env` (from [@BotFather](https://t.me/BotFather)).

Copy the access list and add your Telegram user IDs:

```bash
cp users.example.json users.json
```

Edit `users.json` while the bot is running — changes apply on the next message (no restart needed).

```json
{
  "admins": [{ "id": 123456789, "note": "You" }],
  "users": [{ "id": 987654321, "note": "Friend" }]
}
```

- **admins** — full access; can run `/list`, `/logs`, `/useradd`, `/userremove`, `/adminadd`, `/adminremove`
- **users** — allowed to use the bot

Unknown users get a short denial message with their Telegram user ID so they can ask for access.

### Admin commands

| Command | Description |
|---------|-------------|
| `/list` | Show all admins and users |
| `/logs <date>` | Send log file for a day (`YYYY-MM-DD` or `today`) |
| `/useradd <id> [note]` | Add a user |
| `/userremove <id>` | Remove a user |
| `/adminadd <id> [note]` | Add an admin |
| `/adminremove <id>` | Remove an admin |

Changes are written to `users.json` immediately — no bot restart needed.

## Telegram bot

**Development** (auto-restart on file changes):

```bash
npm run dev
```

**Production** (build + PM2 on the server):

```bash
npm run deploy
```

`npm run dev` uses [nodemon](https://nodemon.io/) and watches `src/` and `.env`.  
`npm run deploy` compiles TypeScript and runs `pm2 startOrReload` via `ecosystem.config.cjs` (starts on first deploy, reloads on later runs).

Useful PM2 commands after deploy:

```bash
npx pm2 status
npx pm2 logs media-downloader-bot
npx pm2 stop media-downloader-bot
```

Send a YouTube or Instagram link in chat. The bot will:

1. Analyze the link (no download yet)
2. Show metadata and quality options
3. Download and send the file after you pick a quality

### Commands

- `/audio <url>` — audio-only options (YouTube and Instagram video)
- `/split <youtube-url> <start> <end>` — download a YouTube clip only

### YouTube clips

Add a time range to a YouTube link:

```
https://youtu.be/... 0:10-0:12
/split https://youtu.be/... 0:10 0:12
```

Clips are not supported for Instagram links.

Telegram limits bot uploads to 50 MB.

### Logging

The bot logs to the terminal and to daily files under `./logs/` (one file per day: `YYYY-MM-DD.log`). Set `LOG_DIR` in `.env` to change the folder.

Terminal lines include user ID, message ID, request ID, platform, and URL when available:

```
16:42:01 INFO  analyze      user=123456789 @alice msg=42 url=https://... | started
```

Progress bars (download/upload) are throttled in log files (every 10%).

## CLI usage

Download YouTube or Instagram media (saved in `./downloads`):

```bash
npm run download -- "https://www.youtube.com/watch?v=VIDEO_ID"
npm run download -- "https://www.instagram.com/reel/SHORTCODE/"
```

Custom output folder:

```bash
npm run download -- "https://youtu.be/VIDEO_ID" -o ~/Videos
```

Audio only (mp3):

```bash
npm run download -- "https://www.youtube.com/watch?v=VIDEO_ID" --audio
```

Build and run the compiled CLI:

```bash
npm run build
npm start -- "https://www.youtube.com/watch?v=VIDEO_ID"
npm start -- "https://www.instagram.com/reel/SHORTCODE/"
```

## Notes

- For personal use only. Respect platform terms and copyright.
- YouTube playlists are disabled by default; only the single linked video is downloaded.
- Instagram carousel posts download the first item by default.
- Only **public** Instagram content is supported (no login/cookies).
