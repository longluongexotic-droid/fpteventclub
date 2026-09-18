import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Member recruitment rules execute in PostgreSQL with real RLS', async (t) => {
  const db = new PGlite();
  const memberA = '00000000-0000-4000-8000-000000000001';
  const memberB = '00000000-0000-4000-8000-000000000002';
  const outsider = '00000000-0000-4000-8000-000000000003';
  const disabled = '00000000-0000-4000-8000-000000000004';
  const openEvent = '10000000-0000-4000-8000-000000000001';
  const closedEvent = '10000000-0000-4000-8000-000000000002';
  const draftEvent = '10000000-0000-4000-8000-000000000003';
  const motivation = 'Tôi muốn đóng góp kinh nghiệm tổ chức và tinh thần đồng đội.';
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      INSERT INTO auth.users (id) VALUES ('${memberA}'), ('${memberB}'), ('${outsider}'), ('${disabled}');
    `);
    const migration = await readFile(new URL('../supabase/migrations/202609180001_member_recruitment.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.query(`INSERT INTO public.fev_members (user_id, display_name, active) VALUES ($1,'Member A',true),($2,'Member B',true),($3,'Inactive',false)`, [memberA, memberB, disabled]);
    await db.query(`INSERT INTO public.fev_recruitment_events (id,title,description,deadline,roles,is_published) VALUES
      ($1,'Test open event','Local test only',now() + interval '1 day',ARRAY['Nội dung','Hậu cần'],true),
      ($2,'Test closed event','Local test only',now() - interval '1 day',ARRAY['Nội dung'],true),
      ($3,'Test draft event','Local test only',now() + interval '1 day',ARRAY['Nội dung'],false)`, [openEvent,closedEvent,draftEvent]);

    async function asActor(role, uid, fn) {
      assert.ok(['anon', 'authenticated'].includes(role));
      await db.exec(`SET ROLE ${role}`);
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
      try { return await fn(); }
      finally { await db.exec("RESET ROLE; RESET request.jwt.claim.sub;"); }
    }
    const submit = (eventId = openEvent, role = 'Nội dung', text = motivation) =>
      db.query('SELECT public.fev_submit_application($1,$2,$3) AS application', [eventId,role,text]);

    await t.test('Visitors can read published events but not draft events or member records', async () => {
      await asActor('anon', null, async () => {
        const events = await db.query('SELECT id FROM public.fev_recruitment_events ORDER BY id');
        assert.deepEqual(events.rows.map(row => row.id), [openEvent,closedEvent]);
        await assert.rejects(db.query('SELECT * FROM public.fev_members'), /permission denied/i);
        await assert.rejects(db.query('SELECT * FROM public.fev_applications'), /permission denied/i);
        await assert.rejects(submit(), /permission denied|FEV_UNAUTHORIZED/i);
      });
    });
    await t.test('An authenticated nonmember and disabled member cannot apply', async () => {
      for (const user of [outsider, disabled]) {
        await asActor('authenticated', user, async () => {
          await assert.rejects(submit(), /FEV_NOT_MEMBER/);
          assert.equal((await db.query('SELECT * FROM public.fev_applications')).rows.length, 0);
        });
      }
    });
    await t.test('Member can only see their own membership', async () => {
      await asActor('authenticated', memberA, async () => {
        const rows = (await db.query('SELECT user_id FROM public.fev_members')).rows;
        assert.deepEqual(rows.map(row => row.user_id), [memberA]);
      });
    });
    await t.test('Invalid roles, past deadlines, unpublished events and invalid text are rejected on the server', async () => {
      await asActor('authenticated', memberA, async () => {
        await assert.rejects(submit(openEvent,'Giả mạo'), /FEV_INVALID_ROLE/);
        await assert.rejects(submit(closedEvent), /FEV_EVENT_CLOSED/);
        await assert.rejects(submit(draftEvent), /FEV_EVENT_CLOSED/);
        await assert.rejects(submit(openEvent,'Nội dung','ngắn'), /FEV_INVALID_MOTIVATION/);
        await assert.rejects(submit(openEvent,'Nội dung','a'.repeat(2001)), /FEV_INVALID_MOTIVATION/);
      });
    });
    await t.test('Valid registration is persisted once for the authenticated member', async () => {
      await asActor('authenticated', memberA, async () => {
        const { application } = (await submit()).rows[0];
        assert.equal(application.user_id,memberA);
        assert.equal(application.event_id,openEvent);
        assert.equal(application.status,'submitted');
        assert.equal(application.motivation,motivation);
        assert.equal((await db.query('SELECT * FROM public.fev_applications')).rows.length,1);
        await assert.rejects(submit(), /FEV_ALREADY_APPLIED|duplicate key/i);
      });
    });
    await t.test('Another member cannot read the first member’s registration or forge ownership', async () => {
      await asActor('authenticated', memberB, async () => {
        assert.equal((await db.query('SELECT * FROM public.fev_applications')).rows.length,0);
        await assert.rejects(db.query(`INSERT INTO public.fev_applications (user_id,event_id,role,motivation) VALUES ($1,$2,'Nội dung',$3)`, [memberA,openEvent,motivation]), /permission denied/i);
        await assert.rejects(db.query("UPDATE public.fev_applications SET status = 'accepted'"), /permission denied/i);
        await assert.rejects(db.query('DELETE FROM public.fev_applications'), /permission denied/i);
        await assert.rejects(db.query('UPDATE public.fev_members SET active = true'), /permission denied/i);
        await assert.rejects(db.query('UPDATE public.fev_recruitment_events SET is_published = true'), /permission denied/i);
        const { application } = (await submit()).rows[0];
        assert.equal(application.user_id,memberB);
      });
    });
    await t.test('Revoking membership immediately denies reading and submitting applications', async () => {
      await db.query('UPDATE public.fev_members SET active = false WHERE user_id = $1',[memberA]);
      await asActor('authenticated', memberA, async () => {
        assert.equal((await db.query('SELECT * FROM public.fev_applications')).rows.length,0);
        await assert.rejects(submit(), /FEV_NOT_MEMBER/);
      });
    });
  } finally {
    await db.close();
  }
});
