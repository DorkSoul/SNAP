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

SNAP is a self-hosted browser music/video player with user accounts, per-user folder permissions, playlists, and cross-device playback sync. Express serves static files and a REST API; the frontend is vanilla JS ES modules with no framework or bundler.

### Backend

- `server.js` — Express app setup, session middleware (file-backed via `session-file-store`), route mounting, a dependency-free WebSocket keepalive endpoint at `/_ws` (server pings every 8 s to keep phone WiFi awake during locked-screen playback), TCP keepalive tuning, and graceful-shutdown flush of user state.
- `lib/data.js` — JSON persistence in `data/` (`users.json`, `userstate.json`, `playlists.json`, `sessions/`). Writes are atomic (temp file + rename). Playback state (`userstate.json`) is cached in memory and flushed to disk on a 5 s debounce because it changes every second during playback; `flushUserState()` runs on SIGTERM/SIGINT. `users.json` is also cached in memory (read on every request by `requireAuth`) with write-through saves — validate request input fully *before* mutating the array `getUsers()` returns.
- `lib/media.js` — `MEDIA_ROOT`, extension allowlists, `safePath()` (normalise + separator-aware prefix check against `MEDIA_ROOT`), and the two permission predicates: `canAccess()` (path is inside a granted folder) and `canBrowse()` (`canAccess` OR ancestor of a grant, so nested grants like `Music/Rock` stay reachable). Admins bypass both.
- `middleware/auth.js` — `requireAuth` / `requireAdmin` (session → user lookup), username/password validators.
- `routes/auth.js` — first-run setup (`/api/auth/setup-check`, `/setup`), login/logout/me. Passwords hashed with bcryptjs.
- `routes/admin.js` — user CRUD (admin only). Guards: can't delete yourself, can't demote the last admin. `allowedPaths` on each user holds granted folder paths relative to `MEDIA_ROOT`.
- `routes/media.js` — `/api/search` (recursive filename search, 200-result cap), `/api/browse`, `/api/stream` (HTTP 206 with full Range parsing incl. suffix ranges and 416s), `/api/artwork` (embedded tags via `music-metadata`, falling back to `folder.jpg`/`cover.jpg` etc.), `/api/metadata`, `/api/clientlog` (authenticated client-side event logging to stdout). Symlinked directories are followed via `stat`.
- `routes/state.js` — per-user playback state (`GET/PUT /api/state`) and remote-control commands, the server side of cross-device sync. Only the current active device (or an explicit `claimActive` takeover, or a queue-clear) may overwrite live state — pushes from other devices are ignored. Commands (`POST /api/command`) carry an id and stay pending until the active device acks them (`POST /api/command/ack`) or a 10 s TTL expires them; state PUTs never clear commands.
- `routes/playlists.js` — per-user playlist CRUD.

The app sets `trust proxy` and `cookie.secure = 'auto'`, so it works behind an HTTPS reverse proxy without config.

### Frontend (`public/js/`, ES modules, entry `main.js`)

Modules export IIFE singletons. To avoid circular imports, cross-module calls go through `window._X` globals assigned in `main.js`; `main.js` also patches `Player.startQueue` to redirect track selection to the active device when one exists.

- `player.js` — `Player`: audio/video elements (switches `med` by extension), queue, shuffle/repeat, localStorage persistence (`snap_state`), and the stall/reconnect machinery for background playback on flaky WiFi (`lastGoodPosition`, stall watcher, visibility handlers).
- `sync-manager.js` — `SyncManager`: 1 s polling of `/api/state`; the "active device" pushes state, others mirror queue/position/play-state and send transport commands via `/api/command` (capturing listeners intercept the transport buttons). Takeover banner/button moves playback between devices.
- `file-browser.js` — directory navigation, full-library search, sort bar, list/grid rendering, multi-select (long-press on touch), lazy duration/artwork loading via IntersectionObserver.
- `queue.js` — `QueueModal` (play now / add next / add to end) and `QueuePanel` (drag-to-reorder, remove).
- `playlists.js`, `admin.js` (user management + lazy folder-permission tree backed by a grant Set), `auth.js` (login overlay + global 401 fetch interceptor), `user-menu.js`, `fullscreen.js` (artwork/video overlay with tap zones), `media-session.js` (lock-screen controls + wake lock), `view-toggle.js`, `utils.js` (clog remote logging, formatting, inline SVG icons).

Queue state, playback position, shuffle/repeat mode, sort and view preference persist to `localStorage` under `snap_*` keys; server-side state in `data/` makes queue/position follow the user across devices.

## Docker / CI

The image is published to `ghcr.io/dorksoul/snap` via GitHub Actions on push to `main` or `testing`:
- `main` → tagged `latest`
- `testing` → tagged `testing`
- Both → tagged with the commit SHA

The compose file mounts your media directory read-only at `/media` (`MEDIA_ROOT=/media`) and a writable data directory at `/app/data` for users, sessions, playlists, and playback state.
