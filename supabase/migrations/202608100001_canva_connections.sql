-- Canva Connect authorisation, per user.
--
-- Canva requires the authorization-code flow with PKCE *and* Basic auth using
-- the client secret, and blocks that exchange from browser clients outright. So
-- the whole handshake lives server-side, and these two tables are what carry it
-- across the redirect.
--
-- Neither table grants any client access. The rows hold a live OAuth grant over
-- someone's Canva account — an access token good for four hours and a refresh
-- token good indefinitely — and nothing in the browser has any reason to read
-- them. Every use goes through an Edge Function on the service role.

create table if not exists public.canva_connections (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  -- Canva currently issues four-hour access tokens. Stored rather than assumed,
  -- because the documentation says the period is subject to change.
  expires_at timestamptz not null,
  scopes text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.canva_connections is
  'Canva Connect OAuth grants. Service-role only: these tokens act on a user''s Canva account.';

/*
 * The PKCE verifier is held here rather than in the browser.
 *
 * A public client keeps its verifier in session storage because it has no
 * secret to protect. This integration is a confidential client — it holds the
 * client secret and exchanges the code server-side — so the verifier never
 * needs to leave the server either, and a `state` returned by the redirect can
 * be checked against something the client could not have invented.
 */
create table if not exists public.canva_oauth_states (
  state text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  -- Short-lived by design: an authorization code that has not been redeemed
  -- within a few minutes is an abandoned flow, not a slow one.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists canva_oauth_states_expiry on public.canva_oauth_states (expires_at);

drop trigger if exists canva_connections_set_updated_at on public.canva_connections;
create trigger canva_connections_set_updated_at
before update on public.canva_connections
for each row execute function public.set_updated_at();

alter table public.canva_connections enable row level security;
alter table public.canva_oauth_states enable row level security;

-- Deliberately no policies on either table. RLS with no policy denies every
-- client request, which is the intent: tokens are read only by the functions
-- that spend them.
