-- Gift-card notifications and a public "is this token in an open gift" lookup.

-- Which tokens are held for an open gift card. Token ids only, nothing about
-- sender or recipient. The gift escrow wallet is also a real wallet, so holding
-- a token there does not by itself mean a gift; this is the authoritative
-- answer the app uses to label a token "in gift-card escrow".
create or replace function public.open_gift_token_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct token_id::text
  from public.gift_cards
  where custody_mode = 'operator_escrow'
    and status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending');
$$;

revoke all on function public.open_gift_token_ids() from public;
grant execute on function public.open_gift_token_ids() to anon, authenticated;

-- Gift lifecycle notifications, created from gift_card_events so every code
-- path (activation, claim, cancel, their retries and reconciliations) alerts
-- people the same way. The notifications unique index keeps each one to once.
create or replace function public.notify_gift_card_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card public.gift_cards%rowtype;
  who text;
  recipient_wallet text;
  recipient_profile uuid;
begin
  select * into card from public.gift_cards where id = new.gift_id;
  if not found then
    return new;
  end if;
  who := coalesce(nullif(card.recipient_name, ''), card.recipient_email);

  if new.event_type = 'escrowed' then
    insert into public.notifications
      (wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (lower(card.sender_wallet), card.sender_id, 'gift.sent', 'Your gift card is live',
       format('Gemstone #%s is in escrow and %s has been emailed the claim link.', card.gem_id, who),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;

    -- The recipient, when they already have an account with a verified wallet.
    select wl.wallet_address, wl.profile_id into recipient_wallet, recipient_profile
    from public.profiles p
    join public.wallet_links wl
      on wl.profile_id = p.id and wl.is_primary and wl.verified_at is not null
    where lower(p.email) = lower(card.recipient_email)
    limit 1;
    if recipient_wallet is not null then
      insert into public.notifications
        (wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
      values
        (lower(recipient_wallet), recipient_profile, 'gift.received', 'You have been sent a gemstone',
         format('A gift card for gemstone #%s is waiting for you. Use the claim link in your email.', card.gem_id),
         '/gift', 'gift_card', card.id::text)
      on conflict do nothing;
    end if;
  elsif new.event_type = 'claimed' then
    insert into public.notifications
      (wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (lower(card.sender_wallet), card.sender_id, 'gift.claimed', 'Your gift was claimed',
       format('%s claimed gemstone #%s.', who, card.gem_id),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;
  elsif new.event_type = 'cancelled' then
    insert into public.notifications
      (wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (lower(card.sender_wallet), card.sender_id, 'gift.cancelled', 'Gift card cancelled',
       format('The gift card for gemstone #%s was cancelled and the token returned to your wallet.', card.gem_id),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists gift_card_events_notify on public.gift_card_events;
create trigger gift_card_events_notify
after insert on public.gift_card_events
for each row execute function public.notify_gift_card_event();
