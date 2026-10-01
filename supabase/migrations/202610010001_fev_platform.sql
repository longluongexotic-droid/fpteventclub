begin;

-- Keep privileged helpers outside the schemas exposed by the Supabase Data API.
create schema if not exists fev_private;
revoke all on schema fev_private from public, anon;
grant usage on schema fev_private to authenticated, supabase_auth_admin;

-- Add approved email addresses here BEFORE creating password-based admin users.
-- Public email sign-up must also be disabled in Supabase Auth settings.
create table fev_private.admin_email_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_email_normalized check (
    email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  )
);
revoke all on table fev_private.admin_email_allowlist from public, anon, authenticated;
grant select on table fev_private.admin_email_allowlist to supabase_auth_admin;

-- Configure this function as Auth > Hooks > Before User Created in Supabase.
-- Google account selection hints such as hd are not an authorization boundary.
create function fev_private.before_user_created(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(pg_catalog.btrim(coalesce(event->'user'->>'email', '')));
  v_provider text := event->'user'->'app_metadata'->>'provider';
begin
  if v_provider = 'google'
     and v_email ~ '^[^@[:space:]]+@fpt\.edu\.vn$' then
    return '{}'::jsonb;
  end if;

  if v_provider = 'email' and exists (
    select 1 from fev_private.admin_email_allowlist a where a.email = v_email
  ) then
    return '{}'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'Only FPT student Google accounts or approved admin emails may register.'
    )
  );
end;
$$;
revoke all on function fev_private.before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.before_user_created(jsonb)
  to supabase_auth_admin;

-- Configure as Auth > Hooks > Custom Access Token too. This checks every new
-- access token, including token refreshes for accounts created before the
-- Before User Created hook was enabled.
create function fev_private.before_access_token(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(pg_catalog.btrim(coalesce(event->'claims'->>'email', '')));
  v_method text := event->>'authentication_method';
  v_fpt_email boolean := v_email ~ '^[^@[:space:]]+@fpt\.edu\.vn$';
  v_admin_email boolean;
  v_amr jsonb := coalesce(event->'claims'->'amr', '[]'::jsonb);
  v_oauth_session boolean;
  v_password_session boolean;
begin
  select exists (
    select 1 from fev_private.admin_email_allowlist a where a.email = v_email
  ) into v_admin_email;

  -- app_metadata.provider is the first linked identity, not necessarily the
  -- method used for this login. The hook event and AMR describe this session.
  if v_method = 'oauth' and v_fpt_email then
    return event;
  end if;

  if v_method in ('password', 'invite', 'recovery', 'email/signup', 'email_change')
     and v_admin_email then
    return event;
  end if;

  if v_method in ('token_refresh', 'totp')
     and pg_catalog.jsonb_typeof(v_amr) = 'array' then
    select
      coalesce(pg_catalog.bool_or(item->>'method' = 'oauth'), false),
      coalesce(pg_catalog.bool_or(item->>'method' in (
        'password', 'invite', 'recovery', 'email/signup', 'email_change'
      )), false)
    into v_oauth_session, v_password_session
    from pg_catalog.jsonb_array_elements(v_amr) as amr(item);

    if (v_oauth_session and v_fpt_email)
       or (not v_oauth_session and v_password_session and v_admin_email) then
      return event;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'This account is not allowed to sign in to FEV.'
    )
  );
end;
$$;
revoke all on function fev_private.before_access_token(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.before_access_token(jsonb)
  to supabase_auth_admin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default 'Thành viên FEV',
  avatar_url text,
  role text not null default 'guest'
    check (role in ('guest', 'member', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_length check (email is null or char_length(email) <= 320),
  constraint profiles_name_length check (char_length(btrim(full_name)) between 1 and 120),
  constraint profiles_avatar_length check (avatar_url is null or char_length(avatar_url) <= 2048)
);

-- The browser cannot insert profiles or change roles. Auth-owned values are synced
-- from auth.users; role and is_active survive later metadata refreshes.
create function fev_private.sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(pg_catalog.btrim(new.email)), '');
  v_name text := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(pg_catalog.btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(pg_catalog.split_part(v_email, '@', 1), ''),
    'Thành viên FEV'
  );
  v_avatar text := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data->>'avatar_url'), ''),
    nullif(pg_catalog.btrim(new.raw_user_meta_data->>'picture'), '')
  );
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, pg_catalog.left(v_email, 320), pg_catalog.left(v_name, 120),
          pg_catalog.left(v_avatar, 2048))
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;
revoke all on function fev_private.sync_auth_profile()
  from public, anon, authenticated, service_role;

create trigger fev_auth_user_created
  after insert on auth.users
  for each row execute function fev_private.sync_auth_profile();
create trigger fev_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function fev_private.sync_auth_profile();

-- Include accounts that existed before this migration; all begin as guests.
insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  pg_catalog.left(nullif(lower(pg_catalog.btrim(u.email)), ''), 320),
  pg_catalog.left(coalesce(
    nullif(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(pg_catalog.split_part(u.email, '@', 1), ''),
    'Thành viên FEV'
  ), 120),
  pg_catalog.left(coalesce(
    nullif(pg_catalog.btrim(u.raw_user_meta_data->>'avatar_url'), ''),
    nullif(pg_catalog.btrim(u.raw_user_meta_data->>'picture'), '')
  ), 2048)
from auth.users u
on conflict (id) do nothing;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  year integer not null check (year between 2000 and 2100),
  category text check (category in ('Nội bộ', 'Cấp trường', 'Toàn thành phố')),
  display_order integer check (display_order is null or display_order >= 1),
  description text not null default '' check (char_length(description) <= 10000),
  cover_image text check (cover_image is null or char_length(cover_image) <= 2048),
  registration_link text check (
    registration_link is null or
    (char_length(registration_link) <= 2048 and
     registration_link ~* '^https://[^[:space:]]+$')
  ),
  is_published boolean not null default true,
  is_recruiting boolean not null default false,
  application_deadline timestamptz,
  recruitment_departments text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint events_department_values check (
    recruitment_departments <@ array[
      'Nội dung', 'Hậu cần', 'Kỹ thuật', 'Truyền thông', 'Đối ngoại'
    ]::text[]
  ),
  constraint events_departments_size check (
    cardinality(recruitment_departments) <= 5
    and array_position(recruitment_departments, null) is null
  ),
  constraint events_recruitment_requirements check (
    not is_recruiting or
    (is_published and application_deadline is not null and
     cardinality(recruitment_departments) between 1 and 5)
  )
);
create index events_public_filters_idx
  on public.events (year desc, category) where is_published;
create index events_archive_order_idx
  on public.events (year desc, display_order asc, created_at desc, id asc)
  where is_published;
create index events_open_recruitment_idx
  on public.events (application_deadline)
  where is_published and is_recruiting;

create table public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  full_name text not null
    check (char_length(btrim(full_name)) between 2 and 120),
  student_id text not null
    check (student_id ~ '^[A-Za-z0-9._-]{4,30}$'),
  email text not null
    check (char_length(email) <= 320 and email ~* '^[^@[:space:]]+@[^@[:space:]]+$'),
  phone text not null
    check (phone ~ '^[+0-9 .()-]{9,24}$'),
  selected_department text not null
    check (selected_department in (
      'Nội dung', 'Hậu cần', 'Kỹ thuật', 'Truyền thông', 'Đối ngoại'
    )),
  cv_portfolio_url text check (
    cv_portfolio_url is null or
    (char_length(cv_portfolio_url) <= 2048 and
     cv_portfolio_url ~* '^https://[^[:space:]]+$')
  ),
  status text not null default 'Đã nhận'
    check (status in (
      'Đã nhận', 'Đang duyệt', 'Phỏng vấn', 'Trúng tuyển', 'Từ chối'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_one_per_event unique (user_id, event_id)
);
create index applications_event_idx
  on public.recruitment_applications (event_id, created_at desc);
create index applications_user_idx
  on public.recruitment_applications (user_id, created_at desc);

create function fev_private.touch_application()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function fev_private.touch_application()
  from public, anon, authenticated, service_role;
create trigger fev_application_updated
  before update on public.recruitment_applications
  for each row execute function fev_private.touch_application();

-- Policy helpers read profiles as their owner to avoid recursive profile RLS.
create function fev_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active
  );
$$;
create function fev_private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
      and (
        p.role = 'admin' or
        (p.role = 'member' and
         p.email ~ '^[^@[:space:]]+@fpt\.edu\.vn$')
      )
  );
$$;
create function fev_private.event_accepts_application(
  p_event_id uuid,
  p_department text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.is_published and e.is_recruiting
      and e.application_deadline > now()
      and p_department = any(e.recruitment_departments)
  );
$$;
create function fev_private.applicant_email_matches(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.email is not null
      and lower(p.email) = lower(pg_catalog.btrim(p_email))
  );
$$;
revoke all on function fev_private.is_admin(), fev_private.is_member(),
  fev_private.event_accepts_application(uuid, text),
  fev_private.applicant_email_matches(text)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.is_admin(), fev_private.is_member(),
  fev_private.event_accepts_application(uuid, text),
  fev_private.applicant_email_matches(text)
  to authenticated;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.recruitment_applications enable row level security;

-- Restrict grants as well as rows. In particular, registration_link must not be
-- queried through events by a guest or anonymous visitor.
revoke all on table public.profiles, public.events,
  public.recruitment_applications from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant select (
  id, title, year, category, display_order, description, cover_image, is_published,
  is_recruiting, application_deadline, recruitment_departments, created_at
) on table public.events to anon, authenticated;
grant insert, update, delete on table public.events to authenticated;
grant select on table public.recruitment_applications to authenticated;
grant insert (
  user_id, event_id, full_name, student_id, email, phone,
  selected_department, cv_portfolio_url
) on table public.recruitment_applications to authenticated;
grant update (status) on table public.recruitment_applications to authenticated;
grant delete on table public.recruitment_applications to authenticated;
grant all on table public.profiles, public.events,
  public.recruitment_applications to service_role;

create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select fev_private.is_admin()));

create policy events_read_published on public.events
  for select to anon, authenticated using (is_published);
create policy events_admin_read on public.events
  for select to authenticated using ((select fev_private.is_admin()));
create policy events_admin_insert on public.events
  for insert to authenticated with check ((select fev_private.is_admin()));
create policy events_admin_update on public.events
  for update to authenticated
  using ((select fev_private.is_admin()))
  with check ((select fev_private.is_admin()));
create policy events_admin_delete on public.events
  for delete to authenticated using ((select fev_private.is_admin()));

create policy applications_read_self_or_admin on public.recruitment_applications
  for select to authenticated
  using (
    ((select fev_private.is_member()) and user_id = (select auth.uid()))
    or (select fev_private.is_admin())
  );
create policy applications_member_insert on public.recruitment_applications
  for insert to authenticated
  with check (
    (select fev_private.is_member())
    and user_id = (select auth.uid())
    and status = 'Đã nhận'
    and fev_private.applicant_email_matches(email)
    and fev_private.event_accepts_application(event_id, selected_department)
  );
create policy applications_admin_update on public.recruitment_applications
  for update to authenticated
  using ((select fev_private.is_admin()))
  with check ((select fev_private.is_admin()));
create policy applications_admin_delete on public.recruitment_applications
  for delete to authenticated using ((select fev_private.is_admin()));

-- The outer function is invoker-only. Its privileged implementation is private,
-- checks the live profile role, then returns one published event's hidden URL.
create function fev_private.member_registration_link(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link text;
begin
  if not fev_private.is_member() then
    raise exception using errcode = '42501', message = 'FEV_NOT_MEMBER';
  end if;

  select e.registration_link into v_link
  from public.events e
  where e.id = p_event_id
    and (e.is_published or fev_private.is_admin());
  return v_link;
end;
$$;
revoke all on function fev_private.member_registration_link(uuid)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.member_registration_link(uuid)
  to authenticated;

create function public.fev_event_registration_link(p_event_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select fev_private.member_registration_link(p_event_id);
$$;
revoke all on function public.fev_event_registration_link(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.fev_event_registration_link(uuid)
  to authenticated;

commit;
