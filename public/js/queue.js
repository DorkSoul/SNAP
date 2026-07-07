'use strict';

import { Player } from './player.js';
import { enc, icons } from './utils.js';

// ── Queue Action Modal ────────────────────────────────────────────────────────

const QueueModal = (() => {
  const overlay    = document.getElementById('queue-modal');
  const trackName  = document.getElementById('modal-track-name');
  const btnPlayNow = document.getElementById('qm-play-now');
  const btnNext    = document.getElementById('qm-play-next');
  const btnAddEnd  = document.getElementById('qm-add-end');
  const btnCancel  = document.getElementById('qm-cancel');

  // paths: array of paths to queue. startIdx: which to start at.
  // For single file: paths=[file], startIdx=0.
  // For play-all: paths=allFiles, startIdx=0.
  let pendingPaths = [];
  let pendingIdx   = 0;
  // The "add next/add end" target is always pendingPaths[pendingIdx]
  function pendingPath() { return pendingPaths[pendingIdx]; }

  function show(title, paths, startIdx) {
    pendingPaths = paths;
    pendingIdx   = startIdx;
    trackName.textContent = title;
    overlay.hidden = false;
  }

  function hide() { overlay.hidden = true; }

  btnPlayNow.addEventListener('click', () => {
    Player.startQueue(pendingPaths, pendingIdx);
    hide();
  });

  btnNext.addEventListener('click', () => {
    // For multi-file (play all) add all after current; for single just add one
    if (pendingPaths.length > 1) {
      pendingPaths.forEach(p => Player.addToEnd(p));
    } else {
      Player.addAfterCurrent(pendingPath());
    }
    hide();
  });

  btnAddEnd.addEventListener('click', () => {
    pendingPaths.forEach(p => Player.addToEnd(p));
    hide();
  });

  btnCancel.addEventListener('click', hide);
  overlay.addEventListener('click', e => { if (e.target === overlay) hide(); });

  function getPendingPaths() { return [...pendingPaths]; }

  return { show, getPendingPaths };
})();

// ── Queue Panel ───────────────────────────────────────────────────────────────

const QueuePanel = (() => {
  const panel    = document.getElementById('queue-panel');
  const listEl   = document.getElementById('queue-list');
  const closeBtn = document.getElementById('queue-close');

  let dragFromIdx     = null;
  let insertBeforeIdx = null;

  function clearDropIndicators() {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  function setupDragHandle(handle, fromIdx) {
    handle.addEventListener('pointerdown', e => {
      if (e.button > 1) return;
      e.preventDefault();
      e.stopPropagation();
      dragFromIdx     = fromIdx;
      insertBeforeIdx = null;
      handle.setPointerCapture(e.pointerId);
      handle.closest('.queue-item').classList.add('queue-dragging');
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    });
    handle.addEventListener('click', e => e.stopPropagation());

    function onMove(e) {
      const qIdx = Player.getQueueIndex();
      const minInsert = qIdx + 1;
      clearDropIndicators();
      const items = Array.from(listEl.querySelectorAll('.queue-item'));
      let placed = false;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          const clamped = Math.max(i, minInsert);
          if (items[clamped]) items[clamped].classList.add('drop-before');
          insertBeforeIdx = clamped;
          placed = true;
          break;
        }
      }
      if (!placed) {
        if (items.length) items[items.length - 1].classList.add('drop-after');
        insertBeforeIdx = items.length;
      }
    }

    function onUp() {
      if (dragFromIdx !== null && insertBeforeIdx !== null)
        Player.reorderQueue(dragFromIdx, insertBeforeIdx);
      cleanup();
    }

    function onCancel() { cleanup(); }

    function cleanup() {
      const el = listEl.querySelector('.queue-dragging');
      if (el) el.classList.remove('queue-dragging');
      clearDropIndicators();
      dragFromIdx     = null;
      insertBeforeIdx = null;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    }
  }

  function open()  { panel.hidden = false; refresh(); }
  function close() { panel.hidden = true; }

  function refresh() {
    if (panel.hidden) return;
    const q   = Player.getQueue();
    const idx = Player.getQueueIndex();
    listEl.innerHTML = '';

    if (q.length === 0) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Queue is empty</div>';
      return;
    }

    q.forEach((path, i) => {
      const isCurrent = i === idx;
      const item = document.createElement('div');
      item.className = 'queue-item' + (isCurrent ? ' current' : '');

      const canDrag = i > idx;
      const handle = document.createElement('span');
      handle.className = 'queue-drag-handle' + (!canDrag ? ' queue-drag-handle--disabled' : '');
      handle.innerHTML = icons.drag;
      if (canDrag) setupDragHandle(handle, i);

      const num = document.createElement('span');
      num.className = 'queue-item-num';
      if (isCurrent) num.innerHTML = icons.playSmall;
      else num.textContent = i + 1;

      const thumb = document.createElement('div');
      thumb.className = 'queue-item-thumb';
      thumb.innerHTML = icons.note;
      const tImg = document.createElement('img');
      tImg.src = `/api/artwork?path=${enc(path)}`;
      tImg.onload = () => { thumb.textContent = ''; thumb.appendChild(tImg); };
      tImg.onerror = () => {};

      const name = document.createElement('span');
      name.className = 'queue-item-name';
      name.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-item-remove';
      removeBtn.innerHTML = icons.close;
      removeBtn.title = 'Remove from queue';
      if (isCurrent) {
        removeBtn.disabled = true;
      } else {
        removeBtn.addEventListener('click', e => { e.stopPropagation(); Player.removeFromQueue(i); });
      }

      item.append(handle, num, thumb, name, removeBtn);
      item.addEventListener('click', () => { Player.jumpTo(i); close(); });
      listEl.appendChild(item);
    });

    const cur = listEl.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  closeBtn.addEventListener('click', close);
  return { open, close, refresh };
})();

export { QueueModal, QueuePanel };
