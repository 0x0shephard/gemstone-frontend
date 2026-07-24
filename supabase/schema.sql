-- Digital Carat private workflow schema.
-- Apply with `supabase db push`; trusted transitions are Edge Function/service-role only.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.wallet_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint not null,
  is_primary boolean not null default false,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(wallet_address)
);
create unique index if not exists wallet_links_one_primary
  on public.wallet_links(profile_id) where is_primary;

create table if not exists public.siwe_nonces (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  nonce_hash text not null unique,
  domain text not null,
  uri text not null,
  chain_id bigint not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists siwe_nonces_profile_created on public.siwe_nonces(profile_id, created_at desc);

create table if not exists public.kyc_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  applicant_id text unique,
  applicant_type text not null default 'individual'
    check (applicant_type in ('individual', 'company')),
  status text not null default 'not_started'
    check (status in ('not_started', 'pending', 'approved', 'rejected', 'on_hold')),
  review_result jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_submissions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  seller_wallet text not null check (seller_wallet ~ '^0x[0-9a-f]{40}$'),
  attributes jsonb not null,
  sale_mode text not null check (sale_mode in ('buy_now', 'auction')),
  custody_preference text not null
    check (custody_preference in ('protocol_custodian', 'approved_existing_custodian')),
  notes text,
  status text not null default 'submitted'
    check (status in ('submitted', 'expert_review', 'changes_requested', 'approved', 'rejected', 'registered')),
  metadata_uri text,
  certificate_hash text check (certificate_hash is null or certificate_hash ~ '^0x[0-9a-f]{64}$'),
  canonical_payload text,
  commitment_nonce text,
  approved_at timestamptz,
  onchain_gem_id numeric,
  activation_tx_hash text check (activation_tx_hash is null or activation_tx_hash ~ '^0x[0-9a-f]{64}$'),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.seller_submissions
  add column if not exists sale_mode text,
  add column if not exists onchain_gem_id numeric,
  add column if not exists activation_tx_hash text,
  add column if not exists activated_at timestamptz;
update public.seller_submissions set sale_mode = 'buy_now' where sale_mode is null;
alter table public.seller_submissions alter column sale_mode set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_submissions_sale_mode_check'
  ) then
    alter table public.seller_submissions
      add constraint seller_submissions_sale_mode_check
      check (sale_mode in ('buy_now', 'auction'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'seller_submissions_activation_tx_hash_check'
  ) then
    alter table public.seller_submissions
      add constraint seller_submissions_activation_tx_hash_check
      check (activation_tx_hash is null or activation_tx_hash ~ '^0x[0-9a-f]{64}$');
  end if;
end
$$;
create index if not exists seller_submissions_owner on public.seller_submissions(seller_id, created_at desc);
drop trigger if exists seller_submissions_set_updated_at on public.seller_submissions;
create trigger seller_submissions_set_updated_at before update on public.seller_submissions
for each row execute function public.set_updated_at();

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid references public.seller_submissions(id) on delete cascade,
  category text not null check (category in ('certificate', 'gem_media', 'redemption_document')),
  bucket text not null,
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create or replace function public.enforce_gem_media_limit()
returns trigger language plpgsql as $$
begin
  if new.category = 'gem_media' and (
    select count(*) from public.evidence_files
    where submission_id = new.submission_id and category = 'gem_media'
  ) >= 10 then
    raise exception 'A submission may contain at most 10 gem media files';
  end if;
  return new;
end;
$$;
drop trigger if exists evidence_files_media_limit on public.evidence_files;
create trigger evidence_files_media_limit before insert on public.evidence_files
for each row execute function public.enforce_gem_media_limit();

create table if not exists public.redemption_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_wallet text not null check (requester_wallet ~ '^0x[0-9a-f]{40}$'),
  gem_id numeric(78,0) not null,
  token_id numeric(78,0) not null,
  fulfillment_method text not null check (fulfillment_method in ('pickup', 'insured_delivery')),
  fulfillment_details jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'committed', 'onchain_requested', 'cancelled', 'fulfilled')),
  request_hash text check (request_hash is null or request_hash ~ '^0x[0-9a-f]{64}$'),
  canonical_payload text,
  commitment_nonce text,
  transaction_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists redemption_requests_owner
  on public.redemption_requests(requester_id, created_at desc);
drop trigger if exists redemption_requests_set_updated_at on public.redemption_requests;
create trigger redemption_requests_set_updated_at before update on public.redemption_requests
for each row execute function public.set_updated_at();

create table if not exists public.audit_records (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_records_profile on public.audit_records(profile_id, created_at desc);

create table if not exists public.sumsub_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload_sha256 text not null,
  processed_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.wallet_links enable row level security;
alter table public.siwe_nonces enable row level security;
alter table public.kyc_profiles enable row level security;
alter table public.seller_submissions enable row level security;
alter table public.evidence_files enable row level security;
alter table public.redemption_requests enable row level security;
alter table public.audit_records enable row level security;
alter table public.sumsub_webhook_events enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists wallet_links_read_own on public.wallet_links;
create policy wallet_links_read_own on public.wallet_links for select
  using (auth.uid() = profile_id);
-- Wallet links and SIWE nonces are written only by Edge Functions.

drop policy if exists kyc_read_own on public.kyc_profiles;
create policy kyc_read_own on public.kyc_profiles for select
  using (auth.uid() = profile_id);

drop policy if exists seller_submissions_read_own on public.seller_submissions;
create policy seller_submissions_read_own on public.seller_submissions for select
  using (auth.uid() = seller_id);
drop policy if exists seller_submissions_insert_approved on public.seller_submissions;
create policy seller_submissions_insert_approved on public.seller_submissions for insert
  with check (
    auth.uid() = seller_id and exists (
      select 1 from public.kyc_profiles
      where profile_id = auth.uid() and status = 'approved'
    )
  );
drop policy if exists seller_submissions_update_draft on public.seller_submissions;
create policy seller_submissions_update_draft on public.seller_submissions for update
  using (auth.uid() = seller_id and status in ('submitted', 'changes_requested'))
  with check (auth.uid() = seller_id and status in ('submitted', 'changes_requested'));
drop policy if exists seller_submissions_delete_incomplete on public.seller_submissions;
create policy seller_submissions_delete_incomplete on public.seller_submissions for delete
  using (auth.uid() = seller_id and status in ('submitted', 'changes_requested'));

drop policy if exists evidence_read_own on public.evidence_files;
create policy evidence_read_own on public.evidence_files for select
  using (auth.uid() = owner_id);
drop policy if exists evidence_insert_own on public.evidence_files;
create policy evidence_insert_own on public.evidence_files for insert
  with check (auth.uid() = owner_id);

drop policy if exists redemptions_read_own on public.redemption_requests;
create policy redemptions_read_own on public.redemption_requests for select
  using (auth.uid() = requester_id);
drop policy if exists redemptions_insert_own on public.redemption_requests;
create policy redemptions_insert_own on public.redemption_requests for insert
  with check (auth.uid() = requester_id);
drop policy if exists redemptions_update_draft on public.redemption_requests;
create policy redemptions_update_draft on public.redemption_requests for update
  using (auth.uid() = requester_id and status = 'draft')
  with check (auth.uid() = requester_id and status = 'draft');

drop policy if exists audit_read_own on public.audit_records;
create policy audit_read_own on public.audit_records for select
  using (auth.uid() = profile_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('certificates', 'certificates', false, 20971520, array['application/pdf','image/jpeg','image/png']),
  ('gem-media', 'gem-media', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('redemption-documents', 'redemption-documents', false, 20971520, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists private_upload_own_prefix on storage.objects;
create policy private_upload_own_prefix on storage.objects for insert to authenticated
  with check (
    bucket_id in ('certificates','gem-media','redemption-documents')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists private_read_own_prefix on storage.objects;
create policy private_read_own_prefix on storage.objects for select to authenticated
  using (
    bucket_id in ('certificates','gem-media','redemption-documents')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists private_delete_own_prefix on storage.objects;
create policy private_delete_own_prefix on storage.objects for delete to authenticated
  using (
    bucket_id in ('certificates','gem-media','redemption-documents')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
