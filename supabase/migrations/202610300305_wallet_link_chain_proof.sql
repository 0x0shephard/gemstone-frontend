-- A wallet link is proof on the chain it was signed for, unless an EOA signed it.
--
-- `wallet_links.chain_id` was written by v1-siwe-verify and never read. That is
-- harmless for an EOA, whose key controls the same address on every chain, but
-- not for a contract wallet (ERC-1271, or ERC-6492 counterfactual): a Safe
-- proven on Sepolia says nothing about who controls that address on Arbitrum
-- One, where it may be a different contract or none.
--
-- Rule: a link is trusted on chain C when `chain_id = C` or
-- `signature_kind = 'eoa'`. v1-siwe-verify now records signature_kind for
-- every new link.
--
-- Known contract links from another chain are demoted from primary, so every
-- server reader (they all ask for `is_primary`) stops trusting them: now, for
-- the active deployment, and again on every future activation of a deployment
-- on another chain. A demoted link is not deleted; the owner signs once more,
-- on this chain, to restore it.
--
-- Legacy links (signature_kind null, written before it was recorded) are left
-- primary. Nearly all are EOAs, and forcing every Sepolia-era user to re-sign
-- costs more than the small risk of a legacy contract-wallet link. Where the
-- server decides from a link itself (notify.ts), a legacy link from another
-- chain counts as an EOA link only if the address has no code on the active
-- chain (`eth_getCode`).

alter table public.wallet_links
  add column if not exists signature_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_links_signature_kind_check'
  ) then
    alter table public.wallet_links
      add constraint wallet_links_signature_kind_check
      check (signature_kind is null or signature_kind in ('eoa', 'contract'));
  end if;
end
$$;

comment on column public.wallet_links.signature_kind is
  'eoa: proven by an ECDSA signature from the address itself, valid on every chain. contract: ERC-1271/6492, valid only on chain_id. Null: linked before this was recorded; kept primary, and trusted off its chain only where the address has no code.';

update public.wallet_links as wl
set is_primary = false
from public.protocol_deployments as pd
where pd.status = 'active'
  and wl.is_primary
  and wl.chain_id <> pd.chain_id
  and wl.signature_kind = 'contract';

create or replace function public.demote_cross_chain_wallet_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.wallet_links
    set is_primary = false
    where is_primary
      and chain_id <> new.chain_id
      and signature_kind = 'contract';
  end if;
  return new;
end;
$$;

drop trigger if exists protocol_deployments_demote_cross_chain_links on public.protocol_deployments;
create trigger protocol_deployments_demote_cross_chain_links
after update of status on public.protocol_deployments
for each row execute function public.demote_cross_chain_wallet_links();
