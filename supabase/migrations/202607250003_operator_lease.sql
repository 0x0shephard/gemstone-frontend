-- Serialize Edge Function transactions sent by the shared Sepolia operator.

create table if not exists public.protocol_operator_leases (
  lease_name text primary key,
  holder_id uuid,
  expires_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);

insert into public.protocol_operator_leases(lease_name)
values ('sepolia-seller-activation')
on conflict (lease_name) do nothing;

alter table public.protocol_operator_leases enable row level security;
revoke all on public.protocol_operator_leases from anon, authenticated;
grant select, update on public.protocol_operator_leases to service_role;
