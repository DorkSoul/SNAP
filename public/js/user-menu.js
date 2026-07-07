'use strict';

import { Auth } from './auth.js';
import { AdminPanel } from './admin.js';

// ── User menu ─────────────────────────────────────────────────────────────────

const UserMenu = (() => {
  const btn      = document.getElementById('user-menu-btn');
  const label    = document.getElementById('user-menu-label');
  const dropdown = document.getElementById('user-menu-dropdown');
  const adminBtn = document.getElementById('user-menu-admin');
  const logoutBtn= document.getElementById('user-menu-logout');

  function setup(user) {
    label.textContent = user.username;
    adminBtn.hidden = user.role !== 'admin';
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });

  document.addEventListener('click', () => { dropdown.hidden = true; });
  dropdown.addEventListener('click', e => e.stopPropagation());

  adminBtn.addEventListener('click', () => { dropdown.hidden = true; AdminPanel.open(); });
  logoutBtn.addEventListener('click', () => { Auth.logout(); });

  return { setup };
})();

export { UserMenu };
