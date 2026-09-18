import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, pbkdf2Sync, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../member-api.js', import.meta.url), 'utf8');
const email = 'member@example.test';
const password = 'local-test-only';
const config = { accounts: [{ id: 'test-member', emailHash: createHash('sha256').update(email).digest('hex'), salt: 'test-salt', passwordHash: pbkdf2Sync(password, 'test-salt', 210000, 32, 'sha256').toString('hex') }], events: [] };
function adapter(settings = config, storage = new Map(), blockStorage = false) {
  const window = {
    FEV_MEMBER_CONFIG: settings, crypto: webcrypto,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { if (blockStorage) throw Error('blocked'); storage.set(key, value); },
      removeItem: (key) => storage.delete(key)
    }
  };
  vm.runInNewContext(source, { window, TextEncoder, Uint8Array, Error });
  return { backend: window.FEVMemberBackend, storage };
}
const login = (backend, fields = {}) => backend.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...fields }) });

test('Visitors have no session and can read the public empty event list', async () => {
  const { backend } = adapter();
  assert.equal((await backend.request('/auth/me')).user, null);
  assert.equal((await backend.request('/recruitment')).events.length, 0);
});

test('Valid local credentials log in, normalize email, and never store a password', async () => {
  const { backend, storage } = adapter();
  const result = await login(backend, { email: '  MEMBER@EXAMPLE.TEST  ' });
  assert.equal(result.user.email, email);
  assert.equal((await backend.request('/auth/me')).user.id, 'test-member');
  assert.equal([...storage.values()].join('').includes(password), false);
  assert.equal((await adapter(config, storage).backend.request('/auth/me')).user.email, email);
});

test('Wrong passwords and unknown emails are rejected with the same message', async () => {
  const { backend } = adapter();
  for (const fields of [{ password: 'wrong' }, { email: 'unknown@example.test' }, { password: '' }]) {
    await assert.rejects(login(backend, fields), (error) => error.status === 401 && error.message === 'Email hoặc mật khẩu không đúng.');
  }
  assert.equal((await backend.request('/auth/me')).user, null);
});

test('Logout removes the local session', async () => {
  const { backend, storage } = adapter();
  await login(backend);
  await backend.request('/auth/logout', { method: 'POST' });
  assert.equal(storage.size, 0);
  assert.equal((await backend.request('/auth/me')).user, null);
});

test('Expired, malformed and unrecognized browser sessions are cleared', async () => {
  const storage = new Map();
  const { backend } = adapter(config, storage);
  const sessions = ['broken JSON', JSON.stringify({ version: 1, user: { id: 'test-member', email }, expiresAt: Date.now() - 1 }), JSON.stringify({ version: 1, user: { id: 'other', email }, expiresAt: Date.now() + 10000 })];
  for (const session of sessions) {
    storage.set('fev-local-member-v1', session);
    assert.equal((await backend.request('/auth/me')).user, null);
    assert.equal(storage.size, 0);
  }
});

test('Blocked browser storage returns an actionable error, not a successful login', async () => {
  await assert.rejects(login(adapter(config, new Map(), true).backend), (error) => error.code === 'STORAGE_UNAVAILABLE');
});

test('Missing account configuration rejects login', async () => {
  const { backend } = adapter({});
  assert.equal(backend.configured, false);
  await assert.rejects(login(backend), (error) => error.code === 'INVALID_CREDENTIALS');
});

test('No fake registration submission is accepted without a receiving service', async () => {
  const { backend } = adapter();
  await login(backend);
  await assert.rejects(backend.request('/applications', { method: 'POST', body: {} }), (error) => error.code === 'NOT_FOUND');
});
