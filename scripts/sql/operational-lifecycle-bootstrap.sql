-- Minimal Supabase-compatible bootstrap for disposable PostgreSQL migration tests.
-- This is intentionally not an application migration and must never be applied to
-- the hosted project. It supplies only the platform-owned schemas/roles that the
-- repository's legacy schema reference expects.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

-- Compatibility columns/tables from the production schema that predate the
-- first checked-in migration.
alter table if exists public.profiles add column if not exists wallet_address text;
alter table if exists public.seller_submissions add column if not exists gem_name text;
alter table if exists public.seller_submissions add column if not exists carats numeric;

create table if not exists public.kyc_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'not_started',
  updated_at timestamptz not null default now()
);
