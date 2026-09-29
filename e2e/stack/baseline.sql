-- End-to-end suite only. Never applied to a deployed project.
--
-- Three tables predate supabase/migrations/: the first migration upgrades them
-- in place (it reads legacy columns such as gem_name and profiles.wallet_address),
-- so a fresh database cannot be built from the migrations alone. The local stack
-- applies this minimal legacy shape first, then every real migration.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  wallet_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kyc_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending',
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_submissions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  gem_name text,
  carats numeric,
  notes text,
  status text not null default 'submitted',
  metadata_uri text,
  certificate_hash text,
  created_at timestamptz not null default now()
);
