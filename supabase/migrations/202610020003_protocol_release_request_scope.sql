-- Forward-only reinforcement after 001/002 were applied.
--
-- Browser data selection follows the immutable release header, not the global
-- active row. Headerless pre-cutover bundles remain pinned to legacy reads;
-- direct browser mutations additionally require that requested deployment to be
-- active. Edge Functions perform their own stricter manifest + release check.

create or replace function public.requested_protocol_deployment_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      (nullif(current_setting('request.headers', true), '')::jsonb
        ->> 'x-protocol-deployment'),
      ''
    ),
    'sepolia-11155111-40fe3f22'
  );
$$;

revoke all on function public.requested_protocol_deployment_id() from public;
grant execute on function public.requested_protocol_deployment_id() to anon, authenticated, service_role;

create or replace function public.requested_protocol_deployment_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.protocol_deployments
    where id = public.requested_protocol_deployment_id()
      and status = 'active'
  );
$$;

revoke all on function public.requested_protocol_deployment_is_active() from public;
grant execute on function public.requested_protocol_deployment_is_active() to anon, authenticated, service_role;

alter table public.evidence_files
  alter column deployment_id set default public.requested_protocol_deployment_id();

drop policy if exists seller_submissions_read_own on public.seller_submissions;
create policy seller_submissions_read_own
on public.seller_submissions for select
to authenticated
using (
  auth.uid() = seller_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists seller_submissions_delete_incomplete on public.seller_submissions;
create policy seller_submissions_delete_incomplete
on public.seller_submissions for delete
to authenticated
using (
  auth.uid() = seller_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and certificate_hash is null
  and onchain_gem_id is null
);

drop policy if exists redemptions_read_own on public.redemption_requests;
create policy redemptions_read_own
on public.redemption_requests for select
to authenticated
using (
  auth.uid() = requester_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists evidence_read_own on public.evidence_files;
create policy evidence_read_own
on public.evidence_files for select
to authenticated
using (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists evidence_insert_own on public.evidence_files;
create policy evidence_insert_own
on public.evidence_files for insert
to authenticated
with check (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    (
      submission_id is not null
      and category in ('certificate', 'gem_media')
      and exists (
        select 1
        from public.seller_submissions
        where id = submission_id
          and deployment_id = public.requested_protocol_deployment_id()
          and seller_id = auth.uid()
          and certificate_hash is null
          and onchain_gem_id is null
      )
    )
    or (submission_id is null and category = 'redemption_document')
  )
);

drop policy if exists evidence_delete_own on public.evidence_files;
create policy evidence_delete_own
on public.evidence_files for delete
to authenticated
using (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    submission_id is null
    or exists (
      select 1
      from public.seller_submissions
      where id = submission_id
        and deployment_id = public.requested_protocol_deployment_id()
        and seller_id = auth.uid()
        and certificate_hash is null
        and onchain_gem_id is null
    )
  )
);

drop policy if exists gift_cards_read_own on public.gift_cards;
create policy gift_cards_read_own
on public.gift_cards for select
to authenticated
using (
  sender_id = auth.uid()
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists valuations_read_own_submission on public.valuations;
create policy valuations_read_own_submission
on public.valuations for select
to authenticated
using (
  deployment_id = public.requested_protocol_deployment_id()
  and exists (
    select 1 from public.seller_submissions s
    where s.id = valuations.submission_id
      and s.deployment_id = public.requested_protocol_deployment_id()
      and s.seller_id = auth.uid()
  )
);

drop policy if exists gift_card_events_parties_read on public.gift_card_events;
create policy gift_card_events_parties_read
on public.gift_card_events for select
to authenticated
using (
  deployment_id = public.requested_protocol_deployment_id()
  and (
    sender_id = auth.uid()
    or public.current_user_has_verified_email(recipient_email)
  )
);

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
on public.notifications for select
to authenticated
using (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read
on public.notifications for update
to authenticated
using (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
)
with check (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
);

create or replace function public.open_gift_token_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct token_id::text
  from public.gift_cards
  where deployment_id = public.requested_protocol_deployment_id()
    and custody_mode = 'operator_escrow'
    and status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending');
$$;

-- Compare-and-swap activation is reversible. An archived deployment is a valid
-- rollback target, and retrying after a successful switch is a no-op.
create or replace function public.activate_protocol_deployment(
  expected_current_id text,
  next_deployment_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_id text;
begin
  lock table public.protocol_deployments in exclusive mode;
  select id into current_id
  from public.protocol_deployments
  where status = 'active';
  if current_id = next_deployment_id then
    return;
  end if;
  if current_id is distinct from expected_current_id then
    raise exception 'Active deployment changed (expected %, found %)', expected_current_id, current_id;
  end if;
  if not exists (
    select 1 from public.protocol_deployments
    where id = next_deployment_id and status in ('staging', 'archived')
  ) then
    raise exception 'Next deployment is not staged or archived: %', next_deployment_id;
  end if;

  update public.protocol_deployments
  set status = 'archived', archived_at = now()
  where id = expected_current_id and status = 'active';
  update public.protocol_deployments
  set status = 'active', activated_at = now(), archived_at = null
  where id = next_deployment_id and status in ('staging', 'archived');
end;
$$;

revoke all on function public.activate_protocol_deployment(text, text) from public;
grant execute on function public.activate_protocol_deployment(text, text) to service_role;
