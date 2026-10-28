-- Close what the anon key could reach.
--
-- Supabase's default privileges grant EXECUTE on every new public function, and
-- ALL on every new public table, to `anon` and `authenticated` by name. A
-- `revoke all ... from public` does not remove those grants, so the functions
-- below stayed callable by anyone holding the anon key that ships in the site's
-- JavaScript. Each is SECURITY DEFINER with no caller check, and each is meant
-- only for Edge Functions running as `service_role`.

-- Anyone could switch the active deployment to the archived one, which makes
-- every deployment-scoped Edge Function fail closed.
revoke all on function public.activate_protocol_deployment(text, text)
  from public, anon, authenticated;
grant execute on function public.activate_protocol_deployment(text, text) to service_role;

-- Anyone could write valuations and spend a lab's daily valuation limit.
-- v1-verification-grade calls it with the service role after its own checks.
revoke all on function public.record_valuation(jsonb) from public, anon, authenticated;
grant execute on function public.record_valuation(jsonb) to service_role;

-- Trigger guards. A trigger fires whatever the caller's EXECUTE rights, so
-- these need no client grant; revoking them keeps the rule above uniform.
revoke all on function public.prevent_gem_custody_amendment_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_gem_custody_term_mutation()
  from public, anon, authenticated;

-- v1-notify-sweep's block cursors. With RLS off, anyone could move a cursor past
-- unscanned blocks and silently drop deadline, offer and redemption notices.
alter table public.notification_scan_state enable row level security;
revoke all on table public.notification_scan_state from anon, authenticated;
grant all on table public.notification_scan_state to service_role;

-- Profiles are written only by handle_new_user, which copies email and name from
-- auth.users, and read by Edge Functions as the service role. The app never
-- writes them. The old FOR ALL policy (and the extra insert/update policies
-- created outside migrations) let a user delete their row, which cascades to
-- their gift records, or set `email` to someone else's address and receive that
-- person's gift notices. A user keeps read access to their own row.
drop policy if exists profiles_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);
revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;
