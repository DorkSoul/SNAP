'use strict';

import { Auth } from './auth.js';

// ── Admin Panel ───────────────────────────────────────────────────────────────

const AdminPanel = (() => {
  const panel        = document.getElementById('admin-panel');
  const closeBtn     = document.getElementById('admin-close');
  const userListEl   = document.getElementById('admin-user-list');
  const addUserBtn   = document.getElementById('admin-add-user-btn');
  const addForm      = document.getElementById('admin-add-user-form');
  const editForm     = document.getElementById('admin-edit-user-form');
  const aeufSelect   = document.getElementById('aeuf-user-select');

  // Add form fields
  const aaufUser  = document.getElementById('aauf-username');
  const aaufPass  = document.getElementById('aauf-password');
  const aaufPass2 = document.getElementById('aauf-password2');
  const aaufRole  = document.getElementById('aauf-role');
  const aaufFolders = document.getElementById('aauf-folders');
  const aaufErr   = document.getElementById('aauf-error');
  const aaufCancel = document.getElementById('aauf-cancel');
  const aaufSubmit = document.getElementById('aauf-submit');

  // Edit form fields
  const aeufPass  = document.getElementById('aeuf-password');
  const aeufPass2 = document.getElementById('aeuf-password2');
  const aeufRole  = document.getElementById('aeuf-role');
  const aeufFolders = document.getElementById('aeuf-folders');
  const aeufErr   = document.getElementById('aeuf-error');
  const aeufCancel = document.getElementById('aeuf-cancel');
  const aeufSubmit = document.getElementById('aeuf-submit');

  let _users = [];
  let _editUserId = null;

  // ── Folder tree ──────────────────────────────────────────────────────────────
  // Grants live in a Set per tree, not in the checkboxes themselves — the tree
  // loads lazily, so grants under folders that were never expanded must survive
  // an edit-and-save round trip. Checkboxes are just a view over the Set.

  function grantCovers(granted, dirPath) {
    for (const g of granted) if (g === dirPath || dirPath.startsWith(g + '/')) return true;
    return false;
  }
  function hasGrantUnder(granted, dirPath) {
    for (const g of granted) if (g.startsWith(dirPath + '/')) return true;
    return false;
  }

  function buildTreeNode(name, dirPath, ctx) {
    const node = document.createElement('div');
    node.className = 'ftree-node';

    const row = document.createElement('div');
    row.className = 'ftree-row';

    const expander = document.createElement('button');
    expander.type = 'button';
    expander.className = 'ftree-expand';
    expander.textContent = '▶';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = dirPath;

    function syncBox() {
      cb.checked = grantCovers(ctx.granted, dirPath);
      cb.indeterminate = !cb.checked && hasGrantUnder(ctx.granted, dirPath);
    }
    ctx.syncFns.add(syncBox);
    syncBox();

    cb.addEventListener('change', () => {
      if (cb.checked) {
        // This grant subsumes any grants below it
        for (const g of [...ctx.granted]) if (g.startsWith(dirPath + '/')) ctx.granted.delete(g);
        ctx.granted.add(dirPath);
      } else {
        // Drop this grant plus any grant below or above it (an ancestor grant
        // would keep this folder accessible, so unchecking must remove it too)
        ctx.granted.delete(dirPath);
        for (const g of [...ctx.granted]) {
          if (g.startsWith(dirPath + '/') || dirPath.startsWith(g + '/')) ctx.granted.delete(g);
        }
      }
      ctx.syncFns.forEach(f => f());
    });

    const lbl = document.createElement('label');
    lbl.className = 'ftree-label';
    lbl.append(cb, document.createTextNode(' ' + name));

    row.append(expander, lbl);
    node.appendChild(row);

    const childWrap = document.createElement('div');
    childWrap.className = 'ftree-children';
    childWrap.hidden = true;
    node.appendChild(childWrap);

    let loaded = false;
    expander.addEventListener('click', async () => {
      if (!loaded) {
        childWrap.innerHTML = '<div class="ftree-loading">Loading…</div>';
        childWrap.hidden = false;
        expander.textContent = '▼';
        try {
          const res = await fetch(`/api/browse?path=${encodeURIComponent(dirPath)}`);
          const data = await res.json();
          const subdirs = (data.items || []).filter(i => i.type === 'dir');
          childWrap.innerHTML = '';
          if (subdirs.length === 0) {
            expander.style.visibility = 'hidden';
          } else {
            for (const sub of subdirs) {
              childWrap.appendChild(buildTreeNode(sub.name, sub.path, ctx));
            }
          }
        } catch {
          childWrap.innerHTML = '<div class="ftree-loading">Error loading</div>';
        }
        loaded = true;
      } else {
        childWrap.hidden = !childWrap.hidden;
        expander.textContent = childWrap.hidden ? '▶' : '▼';
      }
    });

    return node;
  }

  async function renderFolderTree(container, checked) {
    const ctx = { granted: new Set(checked || []), syncFns: new Set() };
    container._ftreeCtx = ctx;
    container.innerHTML = '<div class="ftree-loading">Loading folders…</div>';
    try {
      const res = await fetch('/api/browse?path=');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const dirs = (data.items || []).filter(i => i.type === 'dir');
      container.innerHTML = '';
      if (dirs.length === 0) {
        container.innerHTML = '<span class="ftree-loading">No folders found in media root</span>';
        return;
      }
      for (const dir of dirs) {
        container.appendChild(buildTreeNode(dir.name, dir.path, ctx));
      }
    } catch {
      container.innerHTML = '<span class="ftree-loading">Could not load folders</span>';
    }
  }

  function getCheckedPaths(container) {
    const ctx = container._ftreeCtx;
    if (!ctx) return [];
    // Drop grants already covered by an ancestor grant
    const list = [...ctx.granted];
    return list.filter(g => !list.some(o => o !== g && g.startsWith(o + '/')));
  }

  // ── Users ────────────────────────────────────────────────────────────────────

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return;
      _users = await res.json();
    } catch {}
  }

  function populateEditSelect() {
    const currentId = aeufSelect.value;
    aeufSelect.innerHTML = '<option value="">— choose a user —</option>';
    for (const u of _users) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.username + (u.role === 'admin' ? ' (admin)' : '');
      aeufSelect.appendChild(opt);
    }
    aeufSelect.value = currentId;
  }

  function renderUsers() {
    userListEl.innerHTML = '';
    const currentUser = Auth.currentUser();
    if (_users.length === 0) {
      userListEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No users yet</div>';
      return;
    }
    for (const u of _users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      const nameEl = document.createElement('span');
      nameEl.className = 'user-row-name';
      nameEl.textContent = u.username + (u.id === currentUser?.id ? ' (you)' : '');
      const roleEl = document.createElement('span');
      roleEl.className = 'user-row-role';
      roleEl.textContent = u.role;
      const delBtn = document.createElement('button');
      delBtn.className = 'admin-btn danger';
      delBtn.textContent = 'Delete';
      delBtn.disabled = u.id === currentUser?.id;
      delBtn.addEventListener('click', () => deleteUser(u.id));
      row.append(nameEl, roleEl, delBtn);
      userListEl.appendChild(row);
    }
    populateEditSelect();
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      await loadUsers();
      renderUsers();
      if (_editUserId === id) { editForm.hidden = true; _editUserId = null; }
    } catch {}
  }

  // ── Add form ─────────────────────────────────────────────────────────────────

  addUserBtn.addEventListener('click', () => {
    addForm.hidden = !addForm.hidden;
    if (!addForm.hidden) {
      aaufUser.value = '';
      aaufPass.value = '';
      aaufPass2.value = '';
      aaufRole.value = 'user';
      aaufErr.textContent = '';
      renderFolderTree(aaufFolders, []);
      aaufUser.focus();
    }
  });

  aaufCancel.addEventListener('click', () => { addForm.hidden = true; });

  aaufSubmit.addEventListener('click', async () => {
    aaufErr.textContent = '';
    if (aaufPass.value !== aaufPass2.value) { aaufErr.textContent = 'Passwords do not match.'; return; }
    const body = {
      username: aaufUser.value.trim(),
      password: aaufPass.value,
      role: aaufRole.value,
      allowedPaths: getCheckedPaths(aaufFolders),
    };
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { aaufErr.textContent = data.error || 'Error'; return; }
      addForm.hidden = true;
      await loadUsers();
      renderUsers();
    } catch { aaufErr.textContent = 'Network error'; }
  });

  // ── Edit form (driven by user select dropdown) ────────────────────────────────

  aeufSelect.addEventListener('change', async () => {
    const uid = aeufSelect.value;
    if (!uid) { editForm.hidden = true; _editUserId = null; return; }
    const u = _users.find(u => u.id === uid);
    if (!u) return;
    _editUserId = uid;
    aeufPass.value = '';
    aeufPass2.value = '';
    aeufRole.value = u.role;
    aeufErr.textContent = '';
    editForm.hidden = false;
    await renderFolderTree(aeufFolders, u.allowedPaths || []);
  });

  aeufCancel.addEventListener('click', () => {
    editForm.hidden = true;
    _editUserId = null;
    aeufSelect.value = '';
  });

  aeufSubmit.addEventListener('click', async () => {
    aeufErr.textContent = '';
    if (aeufPass.value && aeufPass.value !== aeufPass2.value) {
      aeufErr.textContent = 'Passwords do not match.'; return;
    }
    const body = {
      role: aeufRole.value,
      allowedPaths: getCheckedPaths(aeufFolders),
    };
    if (aeufPass.value) body.password = aeufPass.value;
    try {
      const res = await fetch(`/api/admin/users/${_editUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { aeufErr.textContent = data.error || 'Error'; return; }
      editForm.hidden = true;
      _editUserId = null;
      aeufSelect.value = '';
      await loadUsers();
      renderUsers();
    } catch { aeufErr.textContent = 'Network error'; }
  });

  closeBtn.addEventListener('click', close);

  async function open() {
    await loadUsers();
    renderUsers();
    addForm.hidden = true;
    editForm.hidden = true;
    panel.hidden = false;
  }

  function close() { panel.hidden = true; }

  return { open, close };
})();

export { AdminPanel };
