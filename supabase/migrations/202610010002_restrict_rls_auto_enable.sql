begin;

-- The RLS auto-enable event trigger runs server-side. Browser and service API
-- roles do not need to invoke its SECURITY DEFINER function directly.
do $$
begin
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() '
      || 'from public, anon, authenticated, service_role';
  end if;
end;
$$;

commit;
