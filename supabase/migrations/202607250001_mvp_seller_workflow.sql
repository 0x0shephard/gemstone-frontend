-- Digital Carat MVP private workflow migration.
-- This migration upgrades the current profiles/kyc_status/seller_submissions
-- database without requiring the context-only schema dump to be replayed.
--
-- Trusted seller creation and approval is performed by the v1-seller-submit
-- Edge Function. Browser clients can only read and clean up their own incomplete
-- submissions and manage evidence files under their own private storage prefix.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Keep profile creation reliable for Google and email-link users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id, email, full_name)
select id, email, raw_user_meta_data ->> 'full_name'
from auth.users
on conflict (id) do nothing;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.wallet_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  chain_id bigint not null,
  is_primary boolean not null default false,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_links_address_check
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint wallet_links_wallet_unique unique(wallet_address)
);

create unique index if not exists wallet_links_one_primary
  on public.wallet_links(profile_id)
  where is_primary;

create index if not exists wallet_links_profile
  on public.wallet_links(profile_id, created_at desc);

drop trigger if exists wallet_links_set_updated_at on public.wallet_links;
create trigger wallet_links_set_updated_at
before update on public.wallet_links
for each row execute function public.set_updated_at();

create table if not exists public.siwe_nonces (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  nonce_hash text not null unique,
  domain text not null,
  uri text not null,
  chain_id bigint not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists siwe_nonces_profile_created
  on public.siwe_nonces(profile_id, created_at desc);

-- Extend the live legacy seller_submissions table in place.
alter table public.seller_submissions
  add column if not exists client_submission_id uuid,
  add column if not exists seller_wallet text,
  add column if not exists attributes jsonb,
  add column if not exists sale_mode text,
  add column if not exists custody_preference text,
  add column if not exists verification_provider text,
  add column if not exists canonical_payload text,
  add column if not exists commitment_nonce text,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists onchain_gem_id numeric(78,0),
  add column if not exists activation_tx_hash text,
  add column if not exists activated_at timestamptz;

update public.seller_submissions
set attributes = jsonb_strip_nulls(
      jsonb_build_object(
        'name', gem_name,
        'caratWeight', carats
      )
    )
where attributes is null;

update public.seller_submissions
set sale_mode = 'buy_now'
where sale_mode is null;

update public.seller_submissions
set custody_preference = 'protocol_custodian'
where custody_preference is null;

update public.seller_submissions
set seller_wallet = lower(profiles.wallet_address)
from public.profiles
where public.seller_submissions.seller_id = profiles.id
  and public.seller_submissions.seller_wallet is null
  and profiles.wallet_address ~* '^0x[0-9a-f]{40}$';

alter table public.seller_submissions
  alter column attributes set not null,
  alter column sale_mode set not null,
  alter column custody_preference set not null;

alter table public.seller_submissions
  drop constraint if exists seller_submissions_status_check,
  drop constraint if exists seller_submissions_sale_mode_check,
  drop constraint if exists seller_submissions_custody_preference_check,
  drop constraint if exists seller_submissions_seller_wallet_check,
  drop constraint if exists seller_submissions_certificate_hash_check,
  drop constraint if exists seller_submissions_activation_tx_hash_check;

alter table public.seller_submissions
  add constraint seller_submissions_status_check
    check (
      status in (
        'submitted',
        'in_review',
        'expert_review',
        'changes_requested',
        'approved',
        'rejected',
        'registered'
      )
    ),
  add constraint seller_submissions_sale_mode_check
    check (sale_mode in ('buy_now', 'auction')),
  add constraint seller_submissions_custody_preference_check
    check (
      custody_preference in (
        'protocol_custodian',
        'approved_existing_custodian'
      )
    ),
  add constraint seller_submissions_seller_wallet_check
    check (seller_wallet is null or seller_wallet ~ '^0x[0-9a-f]{40}$'),
  add constraint seller_submissions_certificate_hash_check
    check (
      certificate_hash is null
      or certificate_hash ~ '^0x[0-9a-f]{64}$'
    ),
  add constraint seller_submissions_activation_tx_hash_check
    check (
      activation_tx_hash is null
      or activation_tx_hash ~ '^0x[0-9a-f]{64}$'
    );

create unique index if not exists seller_submissions_client_id
  on public.seller_submissions(client_submission_id)
  where client_submission_id is not null;

create index if not exists seller_submissions_owner
  on public.seller_submissions(seller_id, created_at desc);

drop trigger if exists seller_submissions_set_updated_at on public.seller_submissions;
create trigger seller_submissions_set_updated_at
before update on public.seller_submissions
for each row execute function public.set_updated_at();

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid references public.seller_submissions(id) on delete cascade,
  category text not null,
  bucket text not null,
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null,
  created_at timestamptz not null default now(),
  constraint evidence_files_category_check
    check (category in ('certificate', 'gem_media', 'redemption_document')),
  constraint evidence_files_digest_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint evidence_files_bucket_category_check
    check (
      (category = 'certificate' and bucket = 'certificates')
      or (category = 'gem_media' and bucket = 'gem-media')
      or (
        category = 'redemption_document'
        and bucket = 'redemption-documents'
      )
    )
);

create index if not exists evidence_files_submission
  on public.evidence_files(submission_id, category);

create or replace function public.enforce_gem_media_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category = 'gem_media' and (
    select count(*)
    from public.evidence_files
    where submission_id = new.submission_id
      and category = 'gem_media'
  ) >= 10 then
    raise exception 'A submission may contain at most 10 gem media files';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_files_media_limit on public.evidence_files;
create trigger evidence_files_media_limit
before insert on public.evidence_files
for each row execute function public.enforce_gem_media_limit();

create table if not exists public.redemption_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_wallet text not null
    check (requester_wallet ~ '^0x[0-9a-f]{40}$'),
  gem_id numeric(78,0) not null,
  token_id numeric(78,0) not null,
  fulfillment_method text not null
    check (fulfillment_method in ('pickup', 'insured_delivery')),
  fulfillment_details jsonb not null,
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'committed',
        'onchain_requested',
        'cancelled',
        'fulfilled'
      )
    ),
  request_hash text
    check (request_hash is null or request_hash ~ '^0x[0-9a-f]{64}$'),
  canonical_payload text,
  commitment_nonce text,
  transaction_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists redemption_requests_owner
  on public.redemption_requests(requester_id, created_at desc);

drop trigger if exists redemption_requests_set_updated_at on public.redemption_requests;
create trigger redemption_requests_set_updated_at
before update on public.redemption_requests
for each row execute function public.set_updated_at();

create table if not exists public.audit_records (
  id bigint generated always as identity primary key,
  profile_id uuid references auth.users(id) on delete set null,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_records_profile
  on public.audit_records(profile_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.kyc_status enable row level security;
alter table public.wallet_links enable row level security;
alter table public.siwe_nonces enable row level security;
alter table public.seller_submissions enable row level security;
alter table public.evidence_files enable row level security;
alter table public.redemption_requests enable row level security;
alter table public.audit_records enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own
on public.profiles for all
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists kyc_status_read_own on public.kyc_status;
create policy kyc_status_read_own
on public.kyc_status for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists wallet_links_read_own on public.wallet_links;
create policy wallet_links_read_own
on public.wallet_links for select
to authenticated
using (auth.uid() = profile_id);

-- SIWE nonces are created and consumed only by trusted Edge Functions.

drop policy if exists seller_submissions_insert_approved on public.seller_submissions;
drop policy if exists seller_submissions_update_draft on public.seller_submissions;
drop policy if exists seller_submissions_read_own on public.seller_submissions;
create policy seller_submissions_read_own
on public.seller_submissions for select
to authenticated
using (auth.uid() = seller_id);

drop policy if exists seller_submissions_delete_incomplete on public.seller_submissions;
create policy seller_submissions_delete_incomplete
on public.seller_submissions for delete
to authenticated
using (
  auth.uid() = seller_id
  and certificate_hash is null
  and onchain_gem_id is null
);

drop policy if exists evidence_read_own on public.evidence_files;
create policy evidence_read_own
on public.evidence_files for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists evidence_insert_own on public.evidence_files;
create policy evidence_insert_own
on public.evidence_files for insert
to authenticated
with check (
  auth.uid() = owner_id
  and (
    (
      submission_id is not null
      and category in ('certificate', 'gem_media')
      and exists (
        select 1
        from public.seller_submissions
        where id = submission_id
          and seller_id = auth.uid()
          and certificate_hash is null
          and onchain_gem_id is null
      )
    )
    or (
      submission_id is null
      and category = 'redemption_document'
    )
  )
);

drop policy if exists evidence_delete_own on public.evidence_files;
create policy evidence_delete_own
on public.evidence_files for delete
to authenticated
using (
  auth.uid() = owner_id
  and (
    submission_id is null
    or exists (
      select 1
      from public.seller_submissions
      where id = submission_id
        and seller_id = auth.uid()
        and certificate_hash is null
        and onchain_gem_id is null
    )
  )
);

drop policy if exists redemptions_read_own on public.redemption_requests;
create policy redemptions_read_own
on public.redemption_requests for select
to authenticated
using (auth.uid() = requester_id);

drop policy if exists audit_read_own on public.audit_records;
create policy audit_read_own
on public.audit_records for select
to authenticated
using (auth.uid() = profile_id);

grant select, update on public.profiles to authenticated;
grant select on public.kyc_status to authenticated;
grant select on public.wallet_links to authenticated;
grant select, delete on public.seller_submissions to authenticated;
grant select, insert, delete on public.evidence_files to authenticated;
grant select on public.redemption_requests to authenticated;
grant select on public.audit_records to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'certificates',
    'certificates',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png']
  ),
  (
    'gem-media',
    'gem-media',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'redemption-documents',
    'redemption-documents',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists private_upload_own_prefix on storage.objects;
create policy private_upload_own_prefix
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('certificates', 'gem-media', 'redemption-documents')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists private_read_own_prefix on storage.objects;
create policy private_read_own_prefix
on storage.objects for select
to authenticated
using (
  bucket_id in ('certificates', 'gem-media', 'redemption-documents')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists private_delete_own_prefix on storage.objects;
create policy private_delete_own_prefix
on storage.objects for delete
to authenticated
using (
  bucket_id in ('certificates', 'gem-media', 'redemption-documents')
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (
    select 1
    from public.evidence_files
    join public.seller_submissions
      on public.seller_submissions.id = public.evidence_files.submission_id
    where public.evidence_files.bucket = bucket_id
      and public.evidence_files.object_path = name
      and public.evidence_files.owner_id = auth.uid()
      and (
        public.seller_submissions.certificate_hash is not null
        or public.seller_submissions.onchain_gem_id is not null
      )
  )
);
