import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/202610020001_protocol_deployment_scope.sql'),
  'utf8',
);
const staging = readFileSync(
  join(process.cwd(), 'supabase/migrations/202610020002_stage_sepolia_fresh_11828947.sql'),
  'utf8',
);
const corrective = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/202610020003_protocol_release_request_scope.sql',
  ),
  'utf8',
);

describe('protocol deployment scope migration', () => {
  it('archives existing chain-derived rows in place without deleting account or workflow data', () => {
    expect(migration).toContain("'sepolia-11155111-40fe3f22'");
    expect(migration).toContain('update public.seller_submissions');
    expect(migration).toContain('update public.gift_cards');
    expect(migration).toContain('update public.redemption_requests');
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\./i);
    expect(migration).not.toMatch(/drop\s+table/i);
  });

  it.each([
    'seller_submissions',
    'evidence_files',
    'valuations',
    'redemption_requests',
    'gift_cards',
    'gift_card_events',
    'auction_cycles',
    'demand_bids',
    'demand_scan_state',
    'notification_scan_state',
    'notification_watch',
    'notifications',
  ])('adds deployment scope to %s', (table) => {
    expect(migration).toContain(`alter table public.${table}`);
  });

  it('makes bare chain identifiers unique only inside one deployment', () => {
    expect(migration).toContain('primary key (deployment_id, gem_id)');
    expect(migration).toContain('(deployment_id, token_id)');
    expect(migration).toContain('unique (deployment_id, kind, entity_id, beneficiary_wallet)');
    expect(migration).toContain('(deployment_id, wallet_address, kind, entity_type, entity_id)');
    expect(migration).toContain('(deployment_id, tx_hash, log_index)');
  });

  it('limits browser-visible gemstone records and public gift lookup to the active deployment', () => {
    for (const policy of [
      'seller_submissions_read_own',
      'redemptions_read_own',
      'gift_cards_read_own',
      'gift_card_events_parties_read',
      'notifications_read_own',
      'valuations_read_own_submission',
    ]) {
      const start = migration.indexOf(`create policy ${policy}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 800)).toContain(
        'public.requested_protocol_deployment_id()',
      );
    }
    const lookup = migration.indexOf('create or replace function public.open_gift_token_ids()');
    expect(lookup).toBeGreaterThan(-1);
    expect(migration.slice(lookup, lookup + 700)).toContain(
      'deployment_id = public.requested_protocol_deployment_id()',
    );
  });

  it('propagates a gift deployment into lifecycle events and notifications', () => {
    expect(migration).toContain('new.deployment_id, new.id, new.sender_id, new.recipient_email');
    expect(migration).toContain('(new.deployment_id, lower(card.sender_wallet), card.sender_id');
    expect(migration).toContain('new.deployment_id := old.deployment_id');
  });

  it('stages the verified fresh manifest without activating it', () => {
    expect(staging).toContain("'sepolia-fresh-11828947'");
    expect(staging).toContain('11828947');
    for (const address of [
      '0x591bB1da8b80C773211301f7fa6f639617182a0d',
      '0x2C4F20f1288Ed0a313C84acb7580da8C53420233',
      '0x4410987B2679bF46AcF75f69372177E882582694',
      '0x7C6a7deCDB433B3B47A4BB73C59E0Cd089e6F1A3',
      '0xD3343fC37621c610C0a601594586656B3199006E',
      '0x8eba95fc2f3eEB4854f8CA751A11dF5FE645F7af',
    ]) {
      expect(staging.toLowerCase()).toContain(address.toLowerCase());
    }
    expect(staging).toContain("'staging'");
    expect(staging).not.toContain("'active'");
  });

  it('provides one locked compare-and-swap activation transaction', () => {
    expect(migration).toContain('lock table public.protocol_deployments in exclusive mode');
    expect(migration).toContain('current_id is distinct from expected_current_id');
    expect(migration).toContain('if current_id = next_deployment_id then');
    expect(migration).toContain("status in ('staging', 'archived')");
    expect(migration).toContain("status = 'archived'");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("status in ('staging', 'archived')");
  });

  it('ships post-staging request scope and rollback semantics forward-only', () => {
    expect(corrective).toContain('public.requested_protocol_deployment_id()');
    expect(corrective).toContain('public.requested_protocol_deployment_is_active()');
    expect(corrective).toContain("status in ('staging', 'archived')");
    expect(corrective).toContain('if current_id = next_deployment_id then');
    expect(corrective).not.toMatch(/\btruncate\b|delete\s+from\s+public\./i);
  });
});
