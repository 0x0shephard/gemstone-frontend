-- Some tokenised stones predate the seller/custody workflow (notably the
-- direct Sepolia demo inventory), so they have no seller_submissions row from
-- which gift issuance can obtain the real reserve escrow term. Do not invent a
-- duration for them. Give an authorised custodian one append-only place to
-- attest the actual agreement date instead.

create table if not exists public.gem_custody_terms (
  deployment_id text not null
    references public.protocol_deployments(id) on delete restrict,
  gem_id numeric(78,0) not null check (gem_id > 0),
  reserve_escrow_ends_at timestamptz not null,
  -- Keep the immutable audit subject without a foreign key. A SET NULL action
  -- would be an UPDATE and conflict with the append-only trigger, while
  -- RESTRICT would prevent an otherwise valid auth-account deletion. The UUID
  -- remains as historical attribution even if the auth row is later removed.
  recorded_by uuid not null,
  organization_id uuid not null
    references public.verifier_organizations(id) on delete restrict,
  attestation_note text not null
    check (char_length(attestation_note) between 10 and 2000),
  recorded_at timestamptz not null default now(),
  primary key (deployment_id, gem_id),
  check (reserve_escrow_ends_at > recorded_at)
);

comment on table public.gem_custody_terms is
  'Insert-only custodian attestations for tokenised gems without an original seller intake row. Never derived from chain state.';
comment on column public.gem_custody_terms.reserve_escrow_ends_at is
  'Actual end of the gem custody agreement; upper bound for newly issued gift-card claims.';
comment on column public.gem_custody_terms.recorded_by is
  'Immutable auth subject UUID at attestation time. Deliberately has no auth.users FK so account deletion neither rewrites the audit row nor fails.';

alter table public.gem_custody_terms enable row level security;

-- No browser policy by design. Reads and the single authorised insert path are
-- service-role mediated by deployment-scoped Edge Functions.
revoke all on public.gem_custody_terms from anon, authenticated;

create or replace function public.prevent_gem_custody_term_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Gem custody terms are append-only';
end;
$$;

revoke all on function public.prevent_gem_custody_term_mutation() from public;

drop trigger if exists gem_custody_terms_append_only on public.gem_custody_terms;
create trigger gem_custody_terms_append_only
before update or delete on public.gem_custody_terms
for each row execute function public.prevent_gem_custody_term_mutation();
