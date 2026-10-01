import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Supabase migration enforces Auth, event and application access', async () => {
  const db = new PGlite();
  const member = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';
  const guest = '00000000-0000-4000-8000-000000000003';
  const admin = '00000000-0000-4000-8000-000000000004';
  const event = '10000000-0000-4000-8000-000000000001';
  const closed = '10000000-0000-4000-8000-000000000002';
  const draft = '10000000-0000-4000-8000-000000000003';
  const apply = (userId, eventId, email, dept = 'Nội dung') => db.query(`
    insert into public.recruitment_applications
      (user_id,event_id,full_name,student_id,email,phone,selected_department)
    values ($1,$2,'Nguyễn Văn A','HE123456',$3,'0912345678',$4)
    returning id,status
  `, [userId, eventId, email, dept]);
  async function as(role, uid, fn) {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid ?? '']);
    try { return await fn(); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub;'); }
  }

  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role supabase_auth_admin nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth
        to anon,authenticated,service_role,supabase_auth_admin;
      grant execute on function auth.uid()
        to anon,authenticated,service_role,supabase_auth_admin;
      insert into auth.users(id,email) values ('${guest}','guest@fpt.edu.vn');
    `);
    const migration = await readFile(
      new URL('../supabase/migrations/202610010001_fev_platform.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.query(`
      insert into auth.users(id,email,raw_user_meta_data) values
        ($1,'member@fpt.edu.vn','{"full_name":"Member"}'),
        ($2,'other@fpt.edu.vn','{}'),
        ($3,'chair@gmail.com','{}')
    `, [member, other, admin]);
    assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 4);
    assert.equal((await db.query('select role from public.profiles where id=$1', [member])).rows[0].role, 'guest');
    await db.query("update public.profiles set role='member' where id in ($1,$2)", [member, other]);
    await db.query("update public.profiles set role='admin' where id=$1", [admin]);
    await db.query(`
      insert into public.events
        (id,title,year,registration_link,is_published,is_recruiting,
         application_deadline,recruitment_departments)
      values
        ($1,'Open',2026,'https://example.com/open',true,true,
         now()+interval '1 day',array['Nội dung','Hậu cần']),
        ($2,'Closed',2025,null,true,true,
         now()-interval '1 day',array['Nội dung']),
        ($3,'Draft',2026,'https://example.com/draft',false,false,
         null,array[]::text[])
    `, [event, closed, draft]);

    await as('supabase_auth_admin', null, async () => {
      const hook = (email, provider) => db.query(
        'select fev_private.before_user_created($1::jsonb) as result',
        [JSON.stringify({ user: { email, app_metadata: { provider } } })],
      );
      assert.deepEqual((await hook('student@fpt.edu.vn', 'google')).rows[0].result, {});
      assert.equal((await hook('outsider@gmail.com', 'google')).rows[0].result.error.http_code, 403);
      assert.equal((await hook('chair@gmail.com', 'email')).rows[0].result.error.http_code, 403);
    });
    await db.query("insert into fev_private.admin_email_allowlist(email) values ('chair@gmail.com')");
    await as('supabase_auth_admin', null, async () => {
      const value = (await db.query(
        `select fev_private.before_user_created('{"user":{"email":"chair@gmail.com","app_metadata":{"provider":"email"}}}'::jsonb) as result`,
      )).rows[0].result;
      assert.deepEqual(value, {});
      const tokenHook = (email, authentication_method, amr = [], provider = 'email') => db.query(
        'select fev_private.before_access_token($1::jsonb) as result',
        [JSON.stringify({ authentication_method, claims: { email, app_metadata: { provider }, amr } })],
      );
      assert.equal((await tokenHook('member@fpt.edu.vn', 'oauth', [], 'email')).rows[0].result.claims.email,
        'member@fpt.edu.vn');
      assert.equal((await tokenHook('chair@gmail.com', 'password', [], 'google')).rows[0].result.claims.email,
        'chair@gmail.com');
      assert.equal((await tokenHook('outsider@gmail.com', 'oauth')).rows[0].result.error.http_code,
        403);
      assert.equal((await tokenHook('member@fpt.edu.vn', 'password')).rows[0].result.error.http_code,
        403);
      assert.equal((await tokenHook('member@fpt.edu.vn', 'token_refresh', [{ method: 'oauth' }])).rows[0].result.claims.email,
        'member@fpt.edu.vn');
      assert.equal((await tokenHook('chair@gmail.com', 'token_refresh', [{ method: 'password' }], 'google')).rows[0].result.claims.email,
        'chair@gmail.com');
      assert.equal((await tokenHook('chair@gmail.com', 'token_refresh', [{ method: 'oauth' }])).rows[0].result.error.http_code,
        403);
      assert.equal((await tokenHook('chair@gmail.com', 'token_refresh')).rows[0].result.error.http_code,
        403);
      assert.equal((await tokenHook('outsider@gmail.com', 'password')).rows[0].result.error.http_code,
        403);
    });

    await as('anon', null, async () => {
      assert.deepEqual((await db.query('select id from public.events order by id')).rows.map(r => r.id), [event, closed]);
      await assert.rejects(db.query('select registration_link from public.events'), /permission denied/i);
      await assert.rejects(db.query('select * from public.profiles'), /permission denied/i);
      await assert.rejects(db.query('select * from public.recruitment_applications'), /permission denied/i);
    });
    await as('authenticated', guest, async () => {
      await assert.rejects(apply(guest, event, 'guest@fpt.edu.vn'), /row-level security/i);
      await assert.rejects(db.query('select public.fev_event_registration_link($1)', [event]), /FEV_NOT_MEMBER/);
      await assert.rejects(db.query('select registration_link from public.events'), /permission denied/i);
      await assert.rejects(db.query("update public.profiles set role='admin' where id=$1", [guest]), /permission denied/i);
      await assert.rejects(db.query("insert into public.events(title,year) values ('Forged',2026)"), /row-level security/i);
    });
    await as('authenticated', member, async () => {
      await assert.rejects(apply(other, event, 'member@fpt.edu.vn'), /row-level security/i);
      await assert.rejects(apply(member, event, 'fake@fpt.edu.vn'), /row-level security/i);
      await assert.rejects(apply(member, event, 'member@fpt.edu.vn', 'Đối ngoại'), /row-level security/i);
      await assert.rejects(apply(member, closed, 'member@fpt.edu.vn'), /row-level security/i);
      await assert.rejects(apply(member, draft, 'member@fpt.edu.vn'), /row-level security/i);
      await assert.rejects(db.query(`
        insert into public.recruitment_applications
          (user_id,event_id,full_name,student_id,email,phone,selected_department,status)
        values ($1,$2,'Nguyễn Văn A','HE123456','member@fpt.edu.vn','0912345678','Nội dung','Trúng tuyển')
      `, [member, event]), /permission denied/i);
      const result = (await apply(member, event, 'member@fpt.edu.vn')).rows[0];
      assert.equal(result.status, 'Đã nhận');
      await assert.rejects(apply(member, event, 'member@fpt.edu.vn'), /duplicate key/i);
      assert.equal((await db.query('select public.fev_event_registration_link($1) as url', [event])).rows[0].url,
        'https://example.com/open');
      assert.equal((await db.query('select public.fev_event_registration_link($1) as url', [draft])).rows[0].url,
        null);
    });
    await as('authenticated', other, async () => {
      assert.equal((await db.query('select id from public.recruitment_applications')).rows.length, 0);
      assert.equal((await db.query("update public.recruitment_applications set status='Trúng tuyển' returning id")).rows.length, 0);
      await apply(other, event, 'other@fpt.edu.vn', 'Hậu cần');
      assert.equal((await db.query('select id from public.recruitment_applications')).rows.length, 1);
    });
    await as('authenticated', admin, async () => {
      assert.equal((await db.query('select id from public.events')).rows.length, 3);
      assert.equal((await db.query('select id from public.recruitment_applications')).rows.length, 2);
      assert.equal((await db.query('select public.fev_event_registration_link($1) as url', [draft])).rows[0].url,
        'https://example.com/draft');
      await db.query("update public.recruitment_applications set status='Phỏng vấn' where user_id=$1", [member]);
      assert.equal((await db.query('select status from public.recruitment_applications where user_id=$1', [member])).rows[0].status,
        'Phỏng vấn');
      await db.query("insert into public.events(title,year) values ('Admin event',2026)");
      assert.equal((await db.query('select id from public.events')).rows.length, 4);
      await db.query("update public.events set registration_link='https://example.com/updated' where id=$1", [event]);
      assert.equal((await db.query('select public.fev_event_registration_link($1) as url', [event])).rows[0].url,
        'https://example.com/updated');
    });
    await db.query('update public.profiles set is_active=false where id=$1', [member]);
    await as('authenticated', member, async () => {
      assert.equal((await db.query('select id from public.recruitment_applications')).rows.length, 0);
      await assert.rejects(db.query('select public.fev_event_registration_link($1)', [event]), /FEV_NOT_MEMBER/);
    });
    await db.query("update auth.users set email='other@example.com' where id=$1", [other]);
    await as('authenticated', other, async () => {
      assert.equal((await db.query('select id from public.recruitment_applications')).rows.length, 0);
      await assert.rejects(db.query('select public.fev_event_registration_link($1)', [event]), /FEV_NOT_MEMBER/);
    });
    const seed = await readFile(new URL('../supabase/seed_events.sql', import.meta.url), 'utf8');
    await db.exec(seed);
    assert.equal((await db.query('select count(*)::int as n from public.events')).rows[0].n, 103);
    await db.exec(seed);
    assert.equal((await db.query('select count(*)::int as n from public.events')).rows[0].n, 103);
  } finally {
    await db.close();
  }
});
