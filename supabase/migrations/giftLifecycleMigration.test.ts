import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/202609290001_gift_lifecycle_recovery.sql'),
  'utf8',
);

describe('gift lifecycle recovery migration', () => {
  it('keeps uncertain mutations open and idempotent', () => {
    expect(migration).toContain('client_request_id uuid');
    expect(migration).toContain('operation_nonce bigint');
    expect(migration).toContain('gift_cards_sender_request');
    expect(migration).toMatch(/'claim_pending'[\s\S]*'cancel_pending'/);
    expect(migration).toMatch(
      /where status in \('pending_escrow', 'active', 'claim_pending', 'cancel_pending'\)/,
    );
  });

  it('records each lifecycle timestamp and transaction hash', () => {
    for (const event of [
      'prepared',
      'escrowed',
      'claim_submitted',
      'claimed',
      'cancel_submitted',
      'cancelled',
    ]) {
      expect(migration).toContain(`'${event}'`);
    }
    expect(migration).toContain('occurred_at timestamptz not null');
    expect(migration).toContain('transaction_hash text');
    expect(migration).toContain('create trigger gift_cards_record_event');
  });

  it('limits event reads to the sender or the verified invited email', () => {
    expect(migration).toContain('sender_id = auth.uid()');
    expect(migration).toContain('public.current_user_has_verified_email(recipient_email)');
    expect(migration).toContain('from auth.users');
    expect(migration).toContain('email_confirmed_at is not null');
    expect(migration).not.toMatch(/create policy[\s\S]*using \(true\)/i);
  });
});
