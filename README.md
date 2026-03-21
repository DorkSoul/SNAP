# SNAP — Self-hosted Network Audio Player

A browser-based music player for self-hosted media libraries. Navigate your file system, stream audio, and control playback from any device on your network — no transcoding, no database, no account required.

---

## Features

- **File system browser** — navigate folders directly, no library scanning needed
- **Grid and list views** — grid shows album art tiles, list shows duration and file size
- **Audio streaming** — HTTP byte-range streaming with full seek support, including long files (podcasts, audiobooks)
- **Embedded artwork** — reads ID3/FLAC tags; falls back to `folder.jpg` / `cover.jpg` in the directory
- **Queue management** — add tracks to end of queue, insert next, or play immediately
- **Shuffle and repeat** — shuffle queue (off/on), repeat modes (off / queue / one)
- **Fullscreen player** — tap album art to open a full-screen player view
- **Multi-select** — long-press a file to enter selection mode, then bulk-play or bulk-add to queue
- **Lock screen controls** — MediaSession API registers SNAP with the OS so playback shows on the lock screen with prev/next/seek controls
- **Session persistence** — queue and playback position survive page refreshes via localStorage
- **Wake lock** — requests Screen Wake Lock during playback to prevent the screen sleeping on mobile
- **Hidden files** — dot-prefixed files and folders are shown (slightly dimmed), useful for NAS layouts
- **Search** — filter the current folder by name in real time

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | Vanilla JS, HTML, CSS — no build step |
| Audio | HTML5 `<audio>` with byte-range streaming |
| Metadata | `music-metadata` npm package |
| Container | Docker (Alpine-based Node image) |

---

## Quick start with Docker

### 1. Pull and run

```bash
docker run -d \
  --name snap \
  -p 3000:3000 \
  -v /path/to/your/media:/media:ro \
  ghcr.io/dorksoul/snap:latest
```

Then open `http://<your-server-ip>:3000` in a browser.

### 2. docker-compose (recommended for Portainer / NAS)

```yaml
services:
  snap:
    image: ghcr.io/dorksoul/snap:latest
    ports:
      - "3000:3000"
    volumes:
      - /path/to/your/media:/media:ro
    environment:
      - MEDIA_ROOT=/media
      - PORT=3000
    restart: unless-stopped
```

Replace `/path/to/your/media` with the absolute path to your music folder.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MEDIA_ROOT` | `/media` | Absolute path inside the container where media is mounted |
| `PORT` | `3000` | Port the server listens on |

---

## Supported formats

`.mp3` `.flac` `.ogg` `.m4a` `.aac` `.wav` `.opus` `.wma` `.m4b` `.mp4` `.mp4a`

Playback support depends on the browser. FLAC, MP3, AAC, and Opus have broad support across modern browsers.

---

## API

The server exposes a small REST API used by the frontend.

| Endpoint | Query params | Description |
|---|---|---|
| `GET /api/browse` | `path` | List directory contents (folders + audio files) |
| `GET /api/stream` | `path` | Stream audio file with HTTP range support |
| `GET /api/artwork` | `path` | Return artwork image (embedded → folder image → 404) |
| `GET /api/metadata` | `path` | Return JSON: `title`, `artist`, `album`, `duration`, `size` |

All `path` values are relative to `MEDIA_ROOT`. Path traversal outside `MEDIA_ROOT` is blocked server-side.

---

## Building from source

```bash
git clone https://github.com/DorkSoul/snap.git
cd snap
npm install
MEDIA_ROOT=/path/to/your/media node server.js
```

### Build Docker image locally

```bash
docker build -t snap .
docker run -d -p 3000:3000 -v /path/to/your/media:/media:ro snap
```

---

## Project structure

```
snap/
├── server.js              # Express API + static file serving
├── package.json
├── Dockerfile
├── docker-compose.yml
└── public/
    ├── index.html         # App shell
    ├── app.js             # All frontend logic
    ├── style.css          # Responsive styles (mobile-first)
    └── logo.svg           # App logo
```

---

## Mobile usage

SNAP is designed to work well on mobile browsers:

- The player bar uses a responsive grid layout optimised for small screens
- Tap album art to open the fullscreen player
- Long-press a file to enter multi-select mode
- Lock screen controls appear via the MediaSession API (tested on Firefox for Android)
- Screen Wake Lock keeps the screen on during playback where supported

---

## CI / CD

Pushing to `main` triggers a GitHub Actions workflow that builds and pushes a Docker image to the GitHub Container Registry:

```
ghcr.io/dorksoul/snap:latest
ghcr.io/dorksoul/snap:<commit-sha>
```
