'use strict';

// ── Auth ──────────────────────────────────────────────────────────────────────

const Auth = (() => {
  const overlay      = document.getElementById('login-overlay');
  const subtitle     = document.getElementById('login-subtitle');
  const userInput    = document.getElementById('login-username');
  const passInput    = document.getElementById('login-password');
  const passConfirmField = document.getElementById('login-confirm-field');
  const passConfirm  = document.getElementById('login-password2');
  const submitBtn    = document.getElementById('login-submit');
  const errorEl      = document.getElementById('login-error');

  let _user = null;
  let _isSetup = false;
  let _onReadyCallback = null;

  function currentUser() { return _user; }

  function showOverlay(isSetup) {
    _isSetup = isSetup;
    subtitle.textContent = isSetup ? 'Create your admin account to get started.' : '';
    submitBtn.textContent = isSetup ? 'Create account' : 'Sign in';
    passConfirmField.hidden = !isSetup;
    passConfirm.value = '';
    errorEl.textContent = '';
    overlay.hidden = false;
  }

  function hideOverlay() { overlay.hidden = true; }

  async function submit() {
    const username = userInput.value.trim();
    const password = passInput.value;
    errorEl.textContent = '';
    if (!username || !password) { errorEl.textContent = 'Enter username and password.'; return; }
    if (_isSetup && password !== passConfirm.value) { errorEl.textContent = 'Passwords do not match.'; return; }
    submitBtn.disabled = true;
    try {
      const endpoint = _isSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { errorEl.textContent = data.error || 'Login failed.'; return; }
      _user = data;
      hideOverlay();
      if (_onReadyCallback) _onReadyCallback();
    } catch (e) {
      errorEl.textContent = 'Network error.';
    } finally {
      submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener('click', submit);
  [userInput, passInput, passConfirm].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  }

  async function init(onReadyCallback) {
    _onReadyCallback = onReadyCallback || null;
    try {
      const setupRes = await fetch('/api/auth/setup-check');
      const { needsSetup } = await setupRes.json();
      if (needsSetup) { showOverlay(true); return; }

      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        _user = await meRes.json();
        hideOverlay();
        if (_onReadyCallback) _onReadyCallback();
      } else {
        showOverlay(false);
      }
    } catch {
      showOverlay(false);
    }
  }

  // Intercept 401s globally
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch(...args);
    if (res.status === 401) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url || '';
      if (!url.includes('/api/auth/')) {
        _user = null;
        showOverlay(false);
      }
    }
    return res;
  };

  return { init, logout, currentUser };
})();

export { Auth };
