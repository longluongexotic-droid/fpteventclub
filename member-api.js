(() => {
  'use strict';

  // Convenience gate for a static website, NOT server authentication.
  // Browser code, stored sessions, and public event links can all be bypassed.
  // Never use this implementation to protect confidential data or permissions.
  const config = window.FEV_MEMBER_CONFIG || {};
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const sessionKey = 'fev-local-member-v1';
  const sessionDuration = 8 * 60 * 60 * 1000;
  const encoder = new TextEncoder();
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

  function failure(message, status = 400, code = 'LOCAL_LOGIN_ERROR') {
    return Object.assign(new Error(message), { status, code });
  }

  function cryptoApi() {
    if (!window.crypto?.subtle) {
      throw failure('Vui lòng mở website bằng HTTPS và sử dụng trình duyệt mới để đăng nhập.', 503);
    }
    return window.crypto.subtle;
  }

  async function emailHash(email) {
    return hex(await cryptoApi().digest('SHA-256', encoder.encode(email)));
  }

  async function passwordHash(password, salt) {
    const api = cryptoApi();
    const key = await api.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    return hex(await api.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256));
  }

  function clearSession() {
    try { window.sessionStorage.removeItem(sessionKey); }
    catch { /* A blocked storage area cannot contain a usable session. */ }
  }

  async function currentMember() {
    try {
      const session = JSON.parse(window.sessionStorage.getItem(sessionKey) || 'null');
      const user = session?.user;
      if (!user || typeof user.email !== 'string' || user.email.length > 254 ||
          session.version !== 1 || !Number.isFinite(session.expiresAt) ||
          session.expiresAt <= Date.now() || session.expiresAt > Date.now() + sessionDuration) {
        clearSession();
        return null;
      }
      const digest = await emailHash(user.email);
      const account = accounts.find((entry) => entry.id === user.id && entry.emailHash === digest);
      if (!account) { clearSession(); return null; }
      // Malformed-state checks only: users control their browser storage.
      return { id: account.id, email: user.email, displayName: user.email.split('@')[0] };
    } catch {
      clearSession();
      return null;
    }
  }

  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
    if (path === '/auth/me' && method === 'GET') return { user: await currentMember() };
    if (path === '/auth/login' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || email.length > 254 || !password || password.length > 256) {
        throw failure('Email hoặc mật khẩu không đúng.', 401, 'INVALID_CREDENTIALS');
      }
      const digest = await emailHash(email);
      const account = accounts.find((entry) => entry.emailHash === digest);
      const derived = await passwordHash(password, account?.salt || 'fev-unknown-member');
      if (!account || derived !== account.passwordHash) {
        throw failure('Email hoặc mật khẩu không đúng.', 401, 'INVALID_CREDENTIALS');
      }
      const user = { id: account.id, email, displayName: email.split('@')[0] };
      try {
        window.sessionStorage.setItem(sessionKey, JSON.stringify({ version: 1, user, expiresAt: Date.now() + sessionDuration }));
      } catch {
        throw failure('Trình duyệt đang chặn lưu phiên. Hãy cho phép lưu trữ của website rồi thử lại.', 503, 'STORAGE_UNAVAILABLE');
      }
      return { user };
    }
    if (path === '/auth/logout' && method === 'POST') {
      clearSession();
      return { user: null };
    }
    if (path === '/recruitment' && method === 'GET') {
      return { events: Array.isArray(config.events) ? config.events : [] };
    }
    // No pretend submission or local-only application receipt.
    throw failure('Chức năng này chưa được cấu hình.', 404, 'NOT_FOUND');
  }

  window.FEVMemberBackend = Object.freeze({ configured: accounts.length > 0, mode: 'local', request });
})();
