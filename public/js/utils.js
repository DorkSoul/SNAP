'use strict';

// ── Remote logging (shows up in docker logs) ──────────────────────────────────
export function clog(event, data) {
  try {
    const body = JSON.stringify({ event, data });
    navigator.sendBeacon('/api/clientlog', new Blob([body], { type: 'application/json' }));
  } catch (_) {}
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function enc(p) { return encodeURIComponent(p); }

// ── Icon SVGs ─────────────────────────────────────────────────────────────────
const S = 'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
export const icons = {
  play:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M5 3.5v17L20 12z"/></svg>`,
  pause:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="5" height="18" rx="2"/><rect x="14" y="3" width="5" height="18" rx="2"/></svg>`,
  prev:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M6 5h2.5v14H6zm2.5 7L19 5v14z"/></svg>`,
  next:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M15.5 5H18v14h-2.5zM5 5l10 7-10 7z"/></svg>`,
  shuffle:   `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  repeat:    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  repeatOne: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">1</text></svg>`,
  close:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="2" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  note:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  folder:    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  check:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="2.5" ${S} aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  drag:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>`,
  menu:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>`,
  grid:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  volume:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  playSmall: `<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M5 3.5v17L20 12z"/></svg>`,
};
