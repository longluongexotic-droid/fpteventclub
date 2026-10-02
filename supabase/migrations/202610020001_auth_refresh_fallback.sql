begin;

-- AMR is an optional JWT claim. Keep the login method bound to the Auth
-- session so a valid refresh can be checked when Auth omits AMR. A session
-- with neither AMR nor a prior trusted record still fails closed.
create table if not exists fev_private.session_auth_methods (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_method text not null check (auth_method in ('oauth', 'password')),
  created_at timestamptz not null default now()
);
revoke all on table fev_private.session_auth_methods
  from public, anon, authenticated, service_role;
grant usage on schema fev_private to supabase_auth_admin;
grant select, insert on table fev_private.session_auth_methods
  to supabase_auth_admin;

create or replace function fev_private.before_access_token(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claims jsonb := event->'claims';
  v_email text := lower(pg_catalog.btrim(coalesce(event->'claims'->>'email', '')));
  v_method text := event->>'authentication_method';
  v_fpt_email boolean := v_email ~ '^[^@[:space:]]+@fpt\.edu\.vn$';
  v_admin_email boolean;
  v_user_id uuid;
  v_session_id uuid;
  v_amr jsonb := event->'claims'->'amr';
  v_amr_oauth boolean := false;
  v_amr_password boolean := false;
  v_decision text;
  v_saved_user_id uuid;
  v_saved_method text;
  v_error jsonb := pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'This account is not allowed to sign in to FEV.'
    )
  );
begin
  -- Both IDs are supplied by Supabase Auth, not by a browser RPC call.
  if event->>'user_id' is null
     or v_claims->>'sub' is distinct from event->>'user_id'
     or v_claims->>'session_id' is null
     or v_claims->>'is_anonymous' = 'true' then
    return v_error;
  end if;
  begin
    v_user_id := (event->>'user_id')::uuid;
    v_session_id := (v_claims->>'session_id')::uuid;
  exception when invalid_text_representation then
    return v_error;
  end;

  select exists (
    select 1 from fev_private.admin_email_allowlist a where a.email = v_email
  ) into v_admin_email;

  if v_method = 'oauth' then
    if v_fpt_email then v_decision := 'oauth'; end if;
  elsif v_method in ('password', 'invite', 'recovery', 'email/signup') then
    if v_admin_email then v_decision := 'password'; end if;
  elsif v_method in ('token_refresh', 'totp', 'email_change') then
    if v_amr is not null and v_amr <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_amr) <> 'array' then
        return v_error;
      end if;
      -- Supabase may encode AMR entries as objects or plain strings.
      select
        coalesce(pg_catalog.bool_or(method = 'oauth'), false),
        coalesce(pg_catalog.bool_or(method in (
          'password', 'invite', 'recovery', 'email/signup'
        )), false)
      into v_amr_oauth, v_amr_password
      from (
        select case
          when pg_catalog.jsonb_typeof(item) = 'object' then item->>'method'
          when pg_catalog.jsonb_typeof(item) = 'string' then item #>> '{}'
          else null
        end as method
        from pg_catalog.jsonb_array_elements(v_amr) as entries(item)
      ) methods;
      -- A nonempty AMR that names no accepted primary method is evidence of
      -- a different login flow; never replace it with the saved method.
      if pg_catalog.jsonb_array_length(v_amr) > 0
         and not v_amr_oauth and not v_amr_password then
        return v_error;
      end if;
    end if;

    if v_amr_oauth then
      v_decision := 'oauth';
    elsif v_amr_password then
      v_decision := 'password';
    else
      select s.auth_method into v_decision
      from fev_private.session_auth_methods s
      where s.session_id = v_session_id and s.user_id = v_user_id;
    end if;

    if (v_decision = 'oauth' and not v_fpt_email)
       or (v_decision = 'password' and not v_admin_email) then
      v_decision := null;
    end if;
  end if;

  if v_decision is null then
    return v_error;
  end if;

  -- Record successful first issuance. On later refreshes AMR and the record
  -- must agree; a mismatch is denied rather than silently changing methods.
  insert into fev_private.session_auth_methods
    (session_id, user_id, auth_method)
  values (v_session_id, v_user_id, v_decision)
  on conflict (session_id) do nothing;

  select s.user_id, s.auth_method
    into v_saved_user_id, v_saved_method
  from fev_private.session_auth_methods s
  where s.session_id = v_session_id;
  if v_saved_user_id is distinct from v_user_id
     or v_saved_method is distinct from v_decision then
    return v_error;
  end if;

  return event;
end;
$$;
revoke all on function fev_private.before_access_token(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function fev_private.before_access_token(jsonb)
  to supabase_auth_admin;

commit;
