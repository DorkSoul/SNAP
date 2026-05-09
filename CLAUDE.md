# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the server locally
node server.js

# Install dependencies
npm ci

# Build and run via Docker
docker build -t snap .
docker compose up
```

There is no build step, no transpilation, and no test or lint scripts. JavaScript is served raw from `public/`.

## Architecture

SNAP is a self-hosted browser music player. Express serves static files and a REST API; the frontend is vanilla JS with no framework or bundler.

**Backend (`server.js`)** — four API endpoints:
- `GET /api/browse?path=` — directory listing filtered to supported audio extensions
- `GET /api/stream?path=` — audio file bytes with HTTP 206 range support (required for seeking)
- `GET /api/artwork?path=` — embedded ID3/FLAC art via `music-metadata`, falling back to `folder.jpg`/`cover.jpg`
- `GET /api/metadata?path=` — title, artist, album, duration extracted from tags

All paths are validated with `safePath()` (normalise + `startsWith(MEDIA_ROOT)`) to prevent traversal.

**Frontend (`public/app.js`)** — module-pattern IIFEs, each owning its own DOM queries and event listeners:
- `Player` — audio element, queue, playback state, localStorage persistence
- `FileBrowser` — directory navigation, multi-select (long-press on touch)
- `QueuePanel` / `QueueModal` — queue display and jump-to-track
- `FullscreenPlayer` — fullscreen artwork/controls overlay
- `MediaSessionManager` — lock-screen media controls via the MediaSession API
- `WakeLock` / `ViewToggle` — screen wake lock and list/grid preference

Queue state, playback position, shuffle/repeat mode, and view preference are all persisted to `localStorage` under `snap_*` keys and restored on load.

## Docker / CI

The image is published to `ghcr.io/dorksoul/snap` via GitHub Actions on push to `main` or `testing`:
- `main` → tagged `latest`
- `testing` → tagged `testing`
- Both → tagged with the commit SHA

The compose file mounts your media directory read-only at `/media` and expects `MEDIA_ROOT=/media`.
