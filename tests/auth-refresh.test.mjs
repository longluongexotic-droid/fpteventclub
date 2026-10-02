import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Auth refresh keeps the verified session method when AMR is absent', async () => {
  const db = new PGlite();
  const member = '00000000-0000-4000-8000-000000000001';
  const admin = '00000000-0000-4000-8000-000000000002';
  const sessions = {
    member: '10000000-0000-4000-8000-000000000001',
    admin: '10000000-0000-4000-8000-000000000002',
    old: '10000000-0000-4000-8000-000000000003',
    unknown: '10000000-0000-4000-8000-000000000004',
    external: '10000000-0000-4000-8000-000000000005',
  };
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role supabase_auth_admin nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create schema fev_private;
      create table fev_private.admin_email_allowlist (email text primary key);
      grant usage on schema fev_private to supabase_auth_admin;
      grant select on fev_private.admin_email_allowlist to supabase_auth_admin;
      insert into auth.users(id) values ('${member}'), ('${admin}');
      insert into fev_private.admin_email_allowlist(email) values ('chair@gmail.com');
    `);
    const sql = await readFile(
      new URL('../supabase/migrations/202610020001_auth_refresh_fallback.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql);
    const issue = async (userId, sessionId, email, authenticationMethod, amr) => {
      const claims = { sub: userId, session_id: sessionId, email, is_anonymous: false };
      if (amr !== undefined) claims.amr = amr;
      const event = { user_id: userId, authentication_method: authenticationMethod, claims };
      return (await db.query(
        'select fev_private.before_access_token($1::jsonb) as result',
        [JSON.stringify(event)],
      )).rows[0].result;
    };
    await db.exec('set role supabase_auth_admin');
    try {
      assert.equal((await issue(member, sessions.member, 'member@fpt.edu.vn', 'oauth')).claims.email,
        'member@fpt.edu.vn');
      assert.equal((await issue(member, sessions.member, 'member@fpt.edu.vn', 'token_refresh')).claims.email,
        'member@fpt.edu.vn');
      assert.equal((await issue(member, sessions.member, 'member@fpt.edu.vn', 'token_refresh', [])).claims.email,
        'member@fpt.edu.vn');
      assert.equal((await issue(admin, sessions.admin, 'chair@gmail.com', 'password')).claims.email,
        'chair@gmail.com');
      assert.equal((await issue(admin, sessions.admin, 'chair@gmail.com', 'token_refresh')).claims.email,
        'chair@gmail.com');

      assert.equal((await issue(admin, sessions.external, 'chair@gmail.com', 'oauth')).error.http_code, 403);
      assert.equal((await issue(member, sessions.external, 'member@fpt.edu.vn', 'password')).error.http_code, 403);
      assert.equal((await issue(admin, sessions.admin, 'chair@gmail.com', 'token_refresh', ['oauth'])).error.http_code,
        403);
      assert.equal((await issue(member, sessions.member, 'member@fpt.edu.vn', 'token_refresh', ['totp'])).error.http_code,
        403);

      assert.equal((await issue(member, sessions.old, 'member@fpt.edu.vn', 'token_refresh', ['oauth'])).claims.email,
        'member@fpt.edu.vn');
      assert.equal((await issue(member, sessions.old, 'member@fpt.edu.vn', 'token_refresh')).claims.email,
        'member@fpt.edu.vn');
      assert.equal((await issue(member, sessions.unknown, 'member@fpt.edu.vn', 'token_refresh')).error.http_code,
        403);
      assert.equal((await issue(member, sessions.member, 'member@fpt.edu.vn', 'token_refresh', { method: 'oauth' })).error.http_code,
        403);
      assert.equal((await issue(admin, sessions.member, 'chair@gmail.com', 'token_refresh')).error.http_code,
        403);
    } finally {
      await db.exec('reset role');
    }
    const rows = (await db.query('select session_id, user_id, auth_method from fev_private.session_auth_methods')).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.session_id === sessions.member).auth_method, 'oauth');
    assert.equal(rows.find((row) => row.session_id === sessions.admin).auth_method, 'password');
    await db.exec('set role anon');
    try {
      await assert.rejects(issue(member, sessions.member, 'member@fpt.edu.vn', 'token_refresh'),
        /permission denied/i);
    } finally {
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});
