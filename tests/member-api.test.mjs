import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../member-api.js', import.meta.url), 'utf8');
function adapter(sdk, config = { supabaseUrl: 'https://project.example', publishableKey: 'public-test-key' }) {
  const window = { FEV_MEMBER_CONFIG: config, supabase: { createClient: () => sdk } };
  vm.runInNewContext(source, { window, URL, Error });
  return window.FEVMemberBackend;
}
function client({ authError = null, member = { active: true, display_name: 'Test member' } } = {}) {
  const calls = [];
  const authUser = { id: 'member-id', email: 'member@example.test' };
  const sdk = {
    auth: {
      async getSession() { calls.push('getSession'); return { data: { session: { access_token: 'untrusted-local-token' } } }; },
      async getUser() { calls.push('getUser'); return { data: { user: authError ? null : authUser }, error: authError }; },
      async signInWithPassword() { return { data: { user: authUser }, error: authError }; },
      async signOut() { calls.push('signOut'); return {}; }
    },
    from(table) {
      assert.equal(table, 'fev_members');
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: member }; } };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: 'application-id', event_id: args.p_event_id, event_title: 'Test event', role: args.p_role, motivation: args.p_motivation, status: 'submitted' } };
    }
  };
  return { sdk, calls };
}

test('Unconfigured portal fails closed without creating an authentication client', async () => {
  const backend = adapter(null, {});
  assert.equal(backend.configured, false);
  await assert.rejects(backend.request('/auth/login', { method: 'POST', body: '{}' }), error => error.code === 'BACKEND_NOT_CONFIGURED');
  await assert.rejects(backend.request('/applications', { method: 'POST', body: '{}' }), error => error.code === 'BACKEND_NOT_CONFIGURED');
});

test('A forged local session does not become a logged-in member', async () => {
  const { sdk, calls } = client({ authError: { status: 401 } });
  const response = await adapter(sdk).request('/auth/me');
  assert.equal(response.user, null);
  assert.deepEqual(calls, ['getSession','getUser','signOut']);
});

test('Successful password authentication still requires an active membership', async () => {
  const { sdk, calls } = client({ member: null });
  await assert.rejects(adapter(sdk).request('/auth/login', { method: 'POST', body: { email: 'member@example.test', password: 'local-test-only' } }), error => error.status === 403 && error.code === 'FEV_NOT_MEMBER');
  assert.ok(calls.includes('signOut'));
});

test('Unknown account and incorrect password do not disclose account existence', async () => {
  const { sdk } = client({ authError: { status: 400, message: 'Potentially sensitive provider error' } });
  await assert.rejects(adapter(sdk).request('/auth/login', { method: 'POST', body: { email: 'member@example.test', password: 'local-test-only' } }), error => error.message === 'Email hoặc mật khẩu không đúng.');
});

test('Application submission rechecks server authentication and ignores client supplied ownership', async () => {
  const { sdk, calls } = client();
  const result = await adapter(sdk).request('/applications', { method: 'POST', body: JSON.stringify({ eventId: 'event-id', role: 'Nội dung', motivation: 'Một lời nhắn đầy đủ cho sự kiện.', userId: 'victim-id' }) });
  assert.equal(result.application.eventId,'event-id');
  assert.equal(result.application.eventTitle,'Test event');
  assert.deepEqual(calls.slice(0,2), ['getSession','getUser']);
  assert.equal(calls[2].name,'fev_submit_application');
  assert.deepEqual(Object.keys(calls[2].args).sort(), ['p_event_id','p_motivation','p_role']);
});
