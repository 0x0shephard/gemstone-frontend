-- Custody agreements can be extended, and a tokenised stone's custodian is
-- disclosed publicly.
--
-- A stone's agreement end date is first recorded on its vault custodian
-- receipt (seller_submissions.reserve_escrow_ends_at) or, for stones without an
-- intake record, as a one-time attestation (gem_custody_terms). Neither is ever
-- rewritten. A signed renewal is recorded here instead, append-only, and may
-- only move the end date later. The effective term is the latest amendment,
-- else the receipt, else the attestation.

create table if not exists public.gem_custody_amendments (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null
    references public.protocol_deployments(id) on delete restrict,
  gem_id numeric(78,0) not null check (gem_id > 0),
  previous_ends_at timestamptz not null,
  new_ends_at timestamptz not null,
  -- The signed amendment or renewal this extension comes from.
  reference text not null check (char_length(reference) between 10 and 2000),
  -- Immutable audit subject, deliberately without an auth.users FK (see
  -- gem_custody_terms.recorded_by).
  amended_by uuid not null,
  organization_id uuid not null
    references public.verifier_organizations(id) on delete restrict,
  amended_at timestamptz not null default now(),
  check (new_ends_at > previous_ends_at),
  check (new_ends_at > amended_at)
);

create index if not exists gem_custody_amendments_gem_idx
  on public.gem_custody_amendments (deployment_id, gem_id, amended_at desc);

comment on table public.gem_custody_amendments is
  'Append-only extensions of a gem custody agreement. The latest row is the effective end date.';

alter table public.gem_custody_amendments enable row level security;
revoke all on public.gem_custody_amendments from anon, authenticated;

create or replace function public.prevent_gem_custody_amendment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Gem custody amendments are append-only';
end;
$$;

revoke all on function public.prevent_gem_custody_amendment_mutation() from public;

drop trigger if exists gem_custody_amendments_append_only on public.gem_custody_amendments;
create trigger gem_custody_amendments_append_only
before update or delete on public.gem_custody_amendments
for each row execute function public.prevent_gem_custody_amendment_mutation();

-- The custodian of record and current agreement end for one gem.
create or replace function public.effective_gem_custody(p_deployment_id text, p_gem_id numeric)
returns table (
  ends_at timestamptz,
  source text,
  organization_id uuid,
  vault_location text
)
language sql
stable
security definer
set search_path = public
as $$
  with receipt as (
    select s.reserve_escrow_ends_at, s.bank_organization_id, s.bank_location
    from public.seller_submissions s
    where s.deployment_id = p_deployment_id
      and s.onchain_gem_id = p_gem_id
      and s.reserve_escrow_ends_at is not null
    order by s.reserve_escrow_ends_at desc
    limit 1
  ),
  attested as (
    select t.reserve_escrow_ends_at, t.organization_id
    from public.gem_custody_terms t
    where t.deployment_id = p_deployment_id and t.gem_id = p_gem_id
  ),
  latest_amendment as (
    select a.new_ends_at
    from public.gem_custody_amendments a
    where a.deployment_id = p_deployment_id and a.gem_id = p_gem_id
    order by a.amended_at desc
    limit 1
  )
  select
    coalesce(
      (select new_ends_at from latest_amendment),
      (select reserve_escrow_ends_at from receipt),
      (select reserve_escrow_ends_at from attested)
    ),
    case
      when exists (select 1 from latest_amendment) then 'amendment'
      when exists (select 1 from receipt) then 'receipt'
      when exists (select 1 from attested) then 'attestation'
    end,
    coalesce(
      (select bank_organization_id from receipt),
      (select organization_id from attested)
    ),
    (select bank_location from receipt)
  where exists (select 1 from receipt) or exists (select 1 from attested);
$$;

revoke all on function public.effective_gem_custody(text, numeric) from public, anon, authenticated;
grant execute on function public.effective_gem_custody(text, numeric) to service_role;

-- Extends the agreement atomically: the caller states the end date it saw, so
-- two concurrent amendments cannot both build on the same previous term.
create or replace function public.amend_gem_custody(
  p_deployment_id text,
  p_gem_id numeric,
  p_expected_ends_at timestamptz,
  p_new_ends_at timestamptz,
  p_reference text,
  p_amended_by uuid,
  p_organization_id uuid
) returns public.gem_custody_amendments
language plpgsql
security definer
set search_path = public
as $$
declare
  current_term record;
  inserted public.gem_custody_amendments;
begin
  perform pg_advisory_xact_lock(hashtext('gem_custody:' || p_deployment_id || ':' || p_gem_id::text));
  select * into current_term from public.effective_gem_custody(p_deployment_id, p_gem_id);
  if current_term.ends_at is null then
    raise exception using errcode = 'DC404',
      message = 'This gemstone has no recorded custody agreement to amend';
  end if;
  if current_term.ends_at <> p_expected_ends_at then
    raise exception using errcode = 'DC409',
      message = 'The custody agreement changed; reload before amending';
  end if;
  if p_new_ends_at <= current_term.ends_at then
    raise exception using errcode = '22023',
      message = 'An amendment can only extend the agreement to a later date';
  end if;
  insert into public.gem_custody_amendments (
    deployment_id, gem_id, previous_ends_at, new_ends_at, reference, amended_by, organization_id
  ) values (
    p_deployment_id, p_gem_id, current_term.ends_at, p_new_ends_at, p_reference,
    p_amended_by, p_organization_id
  ) returning * into inserted;
  return inserted;
end;
$$;

revoke all on function public.amend_gem_custody(text, numeric, timestamptz, timestamptz, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.amend_gem_custody(text, numeric, timestamptz, timestamptz, text, uuid, uuid)
  to service_role;

-- Public custody disclosure for the gem page and cards: who holds the stone,
-- where, and until when. No people, notes or references.
create or replace function public.public_gem_custody(gem_ids numeric[])
returns table (
  gem_id text,
  custodian_name text,
  vault_location text,
  agreement_ends_at timestamptz,
  amended boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g::text,
    o.name,
    e.vault_location,
    e.ends_at,
    e.source = 'amendment'
  from unnest(gem_ids[1:200]) as g
  cross join lateral public.effective_gem_custody(public.requested_protocol_deployment_id(), g) e
  left join public.verifier_organizations o on o.id = e.organization_id;
$$;

revoke all on function public.public_gem_custody(numeric[]) from public;
grant execute on function public.public_gem_custody(numeric[]) to anon, authenticated;

comment on function public.public_gem_custody(numeric[]) is
  'Public custody disclosure per gem: custodian organization, vault location and current agreement end.';
