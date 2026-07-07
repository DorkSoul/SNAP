'use strict';

import { Player } from './player.js';

// ── SyncManager ───────────────────────────────────────────────────────────────

const SyncManager = (() => {
  const takeoverBanner  = document.getElementById('takeover-banner');
  const takeoverBtn     = document.getElementById('takeover-btn');
  const takeoverDismiss = document.getElementById('takeover-dismiss');
  const fsTakeoverBtn   = document.getElementById('fs-btn-takeover');
  const fsTakeoverRow   = document.getElementById('fs-takeover-row');

  let myDeviceId = localStorage.getItem('snap_device_id');
  if (!myDeviceId) {
    myDeviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem('snap_device_id', myDeviceId);
  }

  let pollTimer    = null;
  let serverState  = null;
  let takeoverShown = false;
  let lastExecutedCmdId = null;

  function isActiveDevice() {
    return !serverState?.activeDeviceId || serverState.activeDeviceId === myDeviceId;
  }

  function hasActiveDevice() {
    if (!serverState?.activeDeviceId || serverState.activeDeviceId === myDeviceId) return false;
    return (Date.now() - (serverState.activeDeviceAt || 0)) < 5 * 60 * 1000;
  }

  function updateTakeoverBtn() {
    if (fsTakeoverRow) fsTakeoverRow.hidden = isActiveDevice();
  }

  function getPlayerState() {
    return {
      queue:    Player.getQueue(),
      index:    Player.getQueueIndex(),
      position: Player.getPosition(),
      duration: Player.getDuration(),
      playing:  !Player.paused(),
      deviceId: myDeviceId,
    };
  }

  async function push(opts = {}) {
    const state = getPlayerState();
    if (opts.claim) {
      state.claimActive = true;
    } else if (hasActiveDevice() && state.queue.length > 0) {
      // Never push playback state over another device's live session — it
      // would steal active status and clobber the live position (the server
      // rejects it too; this just avoids the useless request). Queue-clears
      // and explicit claims are deliberate user actions and go through.
      return;
    }
    try {
      await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
    } catch {}
  }

  async function sendCommand(type, data) {
    try {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });
    } catch {}
  }

  async function ackCommand(id) {
    try {
      await fetch('/api/command/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  function executeCommand(cmd) {
    if (!cmd?.type) return;
    if (Date.now() - (cmd.sentAt || 0) > 10000) return; // stale, ignore
    switch (cmd.type) {
      case 'playpause': Player.playPause(); break;
      case 'next':      Player.playNext();  break;
      case 'prev':      Player.playPrev();  break;
      case 'skip':      Player.skip(cmd.data?.seconds || 0); break;
      case 'seek': {
        if (cmd.data?.seekTo != null) Player.seekTo(cmd.data.seekTo);
        break;
      }
      case 'loadqueue': {
        if (Array.isArray(cmd.data?.queue) && cmd.data.queue.length) {
          Player.startQueue(cmd.data.queue, cmd.data.index ?? 0);
        }
        break;
      }
    }
  }

  async function pollAndSync() {
    let res;
    try { res = await fetch('/api/state'); } catch { return; }
    if (!res?.ok) return;
    const state = await res.json();
    const prevActiveId = serverState?.activeDeviceId;
    serverState = state;
    updateTakeoverBtn();

    if (isActiveDevice()) {
      const cmd = state.pendingCommand;
      if (cmd && cmd.id) {
        if (cmd.id !== lastExecutedCmdId) {
          // Track the id so a failed ack can't re-execute the same command
          lastExecutedCmdId = cmd.id;
          executeCommand(cmd);
          ackCommand(cmd.id);
          setTimeout(() => push(), 200);
        } else {
          ackCommand(cmd.id); // previous ack was lost — retry
        }
      } else if (!Player.paused()) {
        // Periodic position push so non-active devices stay in sync
        push();
      }
    } else {
      // Active device cleared its queue — hide takeover and reset local display
      if (!state.queue?.length && !state.activeDeviceId) {
        takeoverBanner.hidden = true;
        takeoverShown = false;
        if (fsTakeoverRow) fsTakeoverRow.hidden = true;
        return;
      }
      // Sync queue/track display from active device (no auto-play)
      if (state.queue?.length > 0) {
        const newPath = state.queue[state.index ?? 0];
        if (newPath && newPath !== Player.getCurrentPath()) {
          Player.syncQueue(state.queue, state.index);
        }
      }
      // Sync playback position and play/pause icon
      if (typeof state.position === 'number') {
        Player.syncPositionDisplay(state.position, state.duration);
      }
      if (typeof state.playing === 'boolean') {
        Player.syncPlayState(state.playing);
      }
      // If we just lost active status (another device took over), pause local audio
      if (prevActiveId === myDeviceId && !Player.paused()) {
        Player.playPause();
      }
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollAndSync, 1000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Takeover button handlers ──────────────────────────────────────────────────
  function takeoverHere() {
    if (!serverState) return;
    // Claim active status before calling loadState so startQueue isn't redirected back
    const snap = { ...serverState };
    serverState = { ...serverState, activeDeviceId: myDeviceId };
    updateTakeoverBtn();
    takeoverBanner.hidden = true;
    if (fsTakeoverRow) fsTakeoverRow.hidden = true;
    Player.loadState({ queue: snap.queue, index: snap.index, position: snap.position });
    push({ claim: true }); // tell the server this device is taking over
  }

  function showTakeover() {
    if (!takeoverShown) {
      takeoverShown = true;
      takeoverBanner.hidden = false;
    }
  }

  takeoverBtn.addEventListener('click', () => { takeoverBanner.hidden = true; takeoverHere(); });
  takeoverDismiss.addEventListener('click', () => { takeoverBanner.hidden = true; });
  if (fsTakeoverBtn) fsTakeoverBtn.addEventListener('click', takeoverHere);

  // ── Transport interception for non-active device ──────────────────────────────
  // Capturing listeners fire before Player's bubble listeners on the same element.
  function makeTransportGuard(type, data) {
    return function(e) {
      if (hasActiveDevice()) {
        e.stopImmediatePropagation();
        sendCommand(type, data);
      }
    };
  }
  ['btn-prev', 'fs-btn-prev'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', makeTransportGuard('prev'), true);
  });
  ['btn-next', 'fs-btn-next'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', makeTransportGuard('next'), true);
  });
  ['btn-play', 'fs-btn-play'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', makeTransportGuard('playpause'), true);
  });
  document.getElementById('fs-btn-skip-back')?.addEventListener('click', makeTransportGuard('skip', { seconds: -30 }), true);
  document.getElementById('fs-btn-skip-fwd')?.addEventListener('click', makeTransportGuard('skip', { seconds: 30 }), true);

  // ── Seek bar interception for non-active device ───────────────────────────────
  ['seek-bar', 'fs-seek-bar'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', e => {
      if (!hasActiveDevice()) return;
      const dur = serverState?.duration || 0;
      if (dur > 0) sendCommand('seek', { seekTo: (parseFloat(e.target.value) / 100) * dur });
    });
  });

  // ── Wire into audio events ────────────────────────────────────────────────────
  document.getElementById('audio').addEventListener('play',  () => { startPolling(); push(); });
  document.getElementById('audio').addEventListener('pause', () => { push(); });

  // ── Push cleared state after Player.clear() runs ─────────────────────────────
  // Player.clear() pauses audio first (which pushes old queue), then empties queue.
  // We push after a tick so getPlayerState() sees the already-cleared queue.
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    setTimeout(() => push(), 0);
  });

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    let res;
    try { res = await fetch('/api/state'); } catch { return; }
    if (!res?.ok) return;
    serverState = await res.json();
    updateTakeoverBtn();

    if (!serverState?.queue?.length || !serverState.activeDeviceAt) { startPolling(); return; }

    const age = Date.now() - serverState.activeDeviceAt;
    if (age > 30 * 60 * 1000) { startPolling(); return; }

    // Silently load queue/track on all devices
    Player.syncQueue(serverState.queue, serverState.index);

    if (serverState.activeDeviceId !== myDeviceId) {
      // Another device is active — show takeover banner
      if (!takeoverShown) {
        takeoverShown = true;
        takeoverBanner.hidden = false;
      }
    }
    startPolling();
  }

  return { init, push, sendCommand, isActiveDevice, hasActiveDevice, showTakeover, myDeviceId };
})();

export { SyncManager };
