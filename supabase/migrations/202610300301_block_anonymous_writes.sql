-- Keep anonymous sign-ins out of every client-writable table and bucket.
--
-- An anonymous sign-in (supabase.auth.signInAnonymously) is a real session in
-- the `authenticated` role. Every policy below that says `to authenticated`
-- therefore also admitted throwaway accounts that anyone with the public anon
-- key can mint in bulk: private storage became free file hosting, and evidence,
-- push and nonce rows could be written without limit. Nothing in the app signs
-- in anonymously. The project setting is being switched off; this is the
-- database half, so turning it back on by mistake does not reopen the tables.
--
-- RESTRICTIVE policies are ANDed with the permissive ones, so the existing
-- ownership rules stay exactly as they are and only anonymous JWTs are
-- refused. The check is the one Supabase documents for this
-- (auth.jwt() ->> 'is_anonymous'), written `is not true` so a token issued
-- before the claim existed (no claim at all) still counts as a permanent user.
-- Wrapped in a sub-select so it is evaluated once per statement, not per row.
--
-- Reads are left alone: an anonymous session owns nothing, so the owner-scoped
-- read policies already return nothing to it.

do $$
declare
  target record;
  command text;
  policy_name text;
  not_anonymous constant text :=
    '((select (auth.jwt() ->> ''is_anonymous'')::boolean) is not true)';
begin
  for target in
    select schema_name, table_name
    from (
      values
        ('storage', 'objects'),
        ('public', 'evidence_files'),
        ('public', 'push_subscriptions'),
        ('public', 'siwe_nonces'),
        ('public', 'wallet_links'),
        ('public', 'notifications'),
        ('public', 'seller_submissions'),
        ('public', 'redemption_requests'),
        ('public', 'profiles')
    ) as targets(schema_name, table_name)
  loop
    if to_regclass(format('%I.%I', target.schema_name, target.table_name)) is null then
      continue;
    end if;
    foreach command in array array['insert', 'update', 'delete'] loop
      policy_name := format('%s_no_anonymous_%s', target.table_name, command);
      execute format(
        'drop policy if exists %I on %I.%I',
        policy_name,
        target.schema_name,
        target.table_name
      );
      execute format(
        'create policy %I on %I.%I as restrictive for %s to authenticated %s',
        policy_name,
        target.schema_name,
        target.table_name,
        command,
        case command
          when 'insert' then format('with check %s', not_anonymous)
          when 'update' then format('using %s with check %s', not_anonymous, not_anonymous)
          else format('using %s', not_anonymous)
        end
      );
    end loop;
  end loop;
end
$$;
