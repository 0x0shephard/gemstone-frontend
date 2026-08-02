-- Lab-gated verification, and the switch that chooses it.
--
-- Before this migration a submission went straight from `submitted` to fully
-- listed inside one `v1-seller-submit` call, which left the grading queue
-- permanently empty: `approved` existed for the duration of a single request and
-- `custody_confirmed` was never a `status` at all, only an `activation_state`.
--
-- Submissions now park at `awaiting_grading` with nothing written on-chain until
-- a lab prices them. That ordering is forced rather than chosen: the lab selects
-- the primary image, the image CID lives inside the metadata document, and
-- `registerGem` writes `metadataURI` to a field with no setter. Registering
-- before grading would fix the document before its contents were decided.

-- Operator-controlled protocol settings. Small and keyed rather than a column per
-- flag, because these are runtime switches an admin flips, not schema.
create table if not exists public.protocol_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- 'lab'  — submissions wait for a graded valuation. Default: the automated
--          figure is explicitly test-only and must not be the fallback.
-- 'auto' — the `mvp-auto` straight-through path, retained for Sepolia demos and
--          the lifecycle verifier, which have no seeded lab account.
insert into public.protocol_settings (key, value)
values ('verification_mode', '"lab"'::jsonb)
on conflict (key) do nothing;

alter table public.protocol_settings
  drop constraint if exists protocol_settings_verification_mode_check;
alter table public.protocol_settings
  add constraint protocol_settings_verification_mode_check
  check (
    key <> 'verification_mode'
    or value #>> '{}' in ('lab', 'auto')
  );

alter table public.protocol_settings enable row level security;

-- No client write path. The setting is changed through `v1-verification-settings`
-- on the service role, which checks admin-organisation membership first.
drop policy if exists protocol_settings_read_verifier on public.protocol_settings;
create policy protocol_settings_read_verifier
on public.protocol_settings for select
to authenticated
using (
  exists (
    select 1 from public.verifier_members m
    where m.profile_id = auth.uid() and m.active
  )
);

-- `awaiting_grading` is the queue state: evidence accepted, nothing on-chain.
-- `graded` is the brief window between a lab recording a valuation and activation
-- completing, so a failed activation is distinguishable from an ungraded stone.
alter table public.seller_submissions
  drop constraint if exists seller_submissions_status_check;
alter table public.seller_submissions
  add constraint seller_submissions_status_check
  check (
    status in (
      'submitted',
      'in_review',
      'awaiting_grading',
      'graded',
      'expert_review',
      'changes_requested',
      'approved',
      'rejected',
      'registered'
    )
  );

-- The image the lab promoted to the NFT `image` field, and the CID it was pinned
-- under. Recorded separately from `metadata_cid` because they are two distinct
-- pinned objects and a lapsed pin has to be reconstructable independently.
alter table public.seller_submissions
  add column if not exists primary_image_evidence_id uuid references public.evidence_files (id),
  add column if not exists primary_image_cid text,
  add column if not exists primary_image_published_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists rejected_by_organization uuid references public.verifier_organizations (id),
  add column if not exists rejected_by_profile uuid references public.profiles (id),
  add column if not exists rejected_at timestamptz;

comment on column public.seller_submissions.primary_image_evidence_id is
  'gem_media row the grader promoted to the public NFT image. Certificates are never eligible.';
comment on column public.seller_submissions.primary_image_cid is
  'IPFS CID of the published image. Referenced from inside metadata_document, so it is fixed once the gem is registered.';

alter table public.seller_submissions
  drop constraint if exists seller_submissions_primary_image_complete;
alter table public.seller_submissions
  add constraint seller_submissions_primary_image_complete
  check (
    (primary_image_cid is null and primary_image_published_at is null)
    or (primary_image_cid is not null and primary_image_published_at is not null)
  );

-- Grading queue lookup: oldest ungraded submission first.
create index if not exists seller_submissions_grading_queue
  on public.seller_submissions (status, created_at)
  where graded_at is null;
