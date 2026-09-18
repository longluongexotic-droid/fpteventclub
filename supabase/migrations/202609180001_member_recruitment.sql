begin;

create schema if not exists fev_private;
revoke all on schema fev_private from public, anon, authenticated;
grant usage on schema fev_private to authenticated;

create table public.fev_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Thành viên FEV'
    check (char_length(btrim(display_name)) between 1 and 120),
  active boolean not null default true
);

create table public.fev_recruitment_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 10000),
  deadline timestamptz not null,
  roles text[] not null default '{}'::text[],
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fev_recruitment_roles_limit check (cardinality(roles) <= 20),
  constraint fev_published_event_has_roles check (not is_published or cardinality(roles) > 0),
  constraint fev_recruitment_roles_not_null check (array_position(roles, null) is null)
);

create table public.fev_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.fev_members(user_id) on delete cascade,
  event_id uuid not null references public.fev_recruitment_events(id) on delete restrict,
  role text not null check (char_length(btrim(role)) between 1 and 120),
  motivation text not null check (char_length(btrim(motivation)) between 20 and 2000),
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  constraint fev_applications_user_event_unique unique (user_id, event_id)
);

create index fev_recruitment_events_published_deadline_idx
  on public.fev_recruitment_events (deadline) where is_published;
create index fev_applications_event_id_idx on public.fev_applications (event_id);

alter table public.fev_members enable row level security;
alter table public.fev_recruitment_events enable row level security;
alter table public.fev_applications enable row level security;

-- Remove Supabase's inherited/default Data API write grants explicitly.
revoke all on table public.fev_members, public.fev_recruitment_events,
  public.fev_applications from public, anon, authenticated;
grant select on table public.fev_members, public.fev_applications to authenticated;
grant select on table public.fev_recruitment_events to anon, authenticated;
grant all on table public.fev_members, public.fev_recruitment_events,
  public.fev_applications to service_role;

create policy fev_members_read_self_active on public.fev_members
  for select to authenticated
  using (user_id = (select auth.uid()) and active);

create policy fev_recruitment_events_read_published on public.fev_recruitment_events
  for select to anon, authenticated
  using (is_published);

create policy fev_applications_read_self_active on public.fev_applications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.fev_members member
      where member.user_id = (select auth.uid()) and member.active
    )
  );

-- The only browser-accessible write path validates membership and the live event.
create function fev_private.submit_application(
  p_event_id uuid,
  p_role text,
  p_motivation text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.fev_recruitment_events%rowtype;
  v_application public.fev_applications%rowtype;
  v_role text := pg_catalog.btrim(p_role);
  v_motivation text := pg_catalog.btrim(p_motivation);
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'FEV_UNAUTHORIZED';
  end if;

  -- Locks prevent a concurrent deactivation or event edit during submission.
  perform member.user_id from public.fev_members member
    where member.user_id = v_user_id and member.active
    for share;
  if not found then
    raise exception using errcode = '42501', message = 'FEV_NOT_MEMBER';
  end if;

  select event.* into v_event from public.fev_recruitment_events event
    where event.id = p_event_id and event.is_published
    for share;
  if not found or v_event.deadline <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '22023', message = 'FEV_EVENT_CLOSED';
  end if;

  if v_role is null or pg_catalog.char_length(v_role) not between 1 and 120
      or not (v_role = any(v_event.roles)) then
    raise exception using errcode = '22023', message = 'FEV_INVALID_ROLE';
  end if;
  if v_motivation is null or pg_catalog.char_length(v_motivation) not between 20 and 2000 then
    raise exception using errcode = '22023', message = 'FEV_INVALID_MOTIVATION';
  end if;

  begin
    insert into public.fev_applications (user_id, event_id, role, motivation)
      values (v_user_id, v_event.id, v_role, v_motivation)
      returning * into v_application;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'FEV_ALREADY_APPLIED';
  end;

  return pg_catalog.jsonb_build_object(
    'id', v_application.id,
    'user_id', v_application.user_id,
    'event_id', v_application.event_id,
    'event_title', v_event.title,
    'role', v_application.role,
    'motivation', v_application.motivation,
    'status', v_application.status,
    'created_at', v_application.created_at
  );
end;
$$;

revoke all on function fev_private.submit_application(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.submit_application(uuid, text, text) to authenticated;

-- The exposed function does not elevate privileges; the validated write implementation stays private.
create function public.fev_submit_application(p_event_id uuid, p_role text, p_motivation text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select fev_private.submit_application(p_event_id, p_role, p_motivation);
$$;

revoke all on function public.fev_submit_application(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fev_submit_application(uuid, text, text) to authenticated;

commit;
