-- Third-party grading labs and the valuations they produce.
--
-- Labs never hold a wallet. They authenticate with Supabase credentials and the
-- platform operator relays their decision on-chain, so verifier identity lives
-- here rather than in an on-chain role grant.

create table if not exists public.verifier_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('lab', 'admin')),
  active boolean not null default true,
  -- Bounds the blast radius of one compromised account, given a single lab
  -- approval writes a permanent valuation with no countersignature.
  daily_valuation_limit integer not null default 25 check (daily_valuation_limit > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.verifier_members (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.verifier_organizations (id) on delete cascade,
  role text not null check (role in ('grader', 'org_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, organization_id)
);

create index if not exists verifier_members_active_idx
  on public.verifier_members (profile_id) where active;

-- Lab-authoritative grades, kept apart from the seller's claims. The seller says
-- VVS, the lab may say SI1; the engine prices the lab's grade and the difference
-- stays visible rather than being overwritten.
alter table public.seller_submissions
  add column if not exists graded_attributes jsonb,
  add column if not exists graded_by_organization uuid references public.verifier_organizations (id),
  add column if not exists graded_by_profile uuid references public.profiles (id),
  add column if not exists graded_at timestamptz;

comment on column public.seller_submissions.graded_attributes is
  'Lab-authoritative grades. Distinct from attributes, which are seller claims.';

-- Append-only valuation history. A revaluation inserts a new row and marks the
-- previous one superseded, so a stone''s full pricing history is reconstructable.
create table if not exists public.valuations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.seller_submissions (id) on delete cascade,
  gem_id numeric(78, 0),
  organization_id uuid references public.verifier_organizations (id),
  graded_by uuid references public.profiles (id),
  matrix_version text not null,
  matrix_hash text not null,
  -- Inputs and the demand counts they were priced against. Without the snapshot
  -- the valuation cannot be re-derived once bid counts move.
  graded_inputs jsonb not null,
  demand_snapshot jsonb not null,
  breakdown jsonb not null,
  approved_valuation_usd numeric(78, 0) not null,
  valuation_hash text not null,
  canonical_payload text not null,
  nonce text not null,
  tx_hash text,
  superseded_by uuid references public.valuations (id),
  created_at timestamptz not null default now()
);

create index if not exists valuations_submission_idx on public.valuations (submission_id, created_at desc);
create index if not exists valuations_org_created_idx on public.valuations (organization_id, created_at desc);

alter table public.verifier_organizations enable row level security;
alter table public.verifier_members enable row level security;
alter table public.valuations enable row level security;

-- Members may see their own membership, and nothing else by default. The queue
-- and grading paths run through Edge Functions on the service role, which is
-- what strips seller identity before anything reaches a lab.
drop policy if exists verifier_members_read_own on public.verifier_members;
create policy verifier_members_read_own
on public.verifier_members for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists verifier_organizations_read_member on public.verifier_organizations;
create policy verifier_organizations_read_member
on public.verifier_organizations for select
to authenticated
using (
  exists (
    select 1 from public.verifier_members m
    where m.organization_id = verifier_organizations.id
      and m.profile_id = auth.uid()
      and m.active
  )
);

-- Sellers may read valuations of their own submissions; labs read through the
-- service role. No direct client write path exists.
drop policy if exists valuations_read_own_submission on public.valuations;
create policy valuations_read_own_submission
on public.valuations for select
to authenticated
using (
  exists (
    select 1 from public.seller_submissions s
    where s.id = valuations.submission_id and s.seller_id = auth.uid()
  )
);
