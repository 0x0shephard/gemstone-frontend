import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const endpoint = source('supabase/functions/v1-gift-create/index.ts');
const prepare = endpoint.slice(endpoint.indexOf("if (action !== 'prepare')"));

describe('gift preparation conflicts', () => {
  it('retires stale pending setups only after proving the sender still holds the token', () => {
    const ownership = prepare.indexOf('if (getAddress(owner) !== senderWallet)');
    const retire = prepare.indexOf(".update({ status: 'cancelled'");
    const insert = prepare.indexOf('.insert({');

    expect(ownership).toBeGreaterThan(-1);
    expect(retire).toBeGreaterThan(ownership);
    expect(insert).toBeGreaterThan(retire);

    const retirement = prepare.slice(retire, insert);
    expect(retirement).toContain(".eq('token_id', tokenId.toString())");
    // Never a live, claiming or cancelling card: those may be backed by escrow.
    expect(retirement).toContain(".eq('status', 'pending_escrow')");
    expect(retirement).not.toMatch(/'active'|'claim_pending'|'cancel_pending'/);
    expect(retirement).toContain("'gift.superseded'");
  });

  it('reads the latest reserve escrow term and does not swallow lookup errors', () => {
    const lookup = prepare.slice(
      prepare.indexOf(".from('seller_submissions')"),
      prepare.indexOf('if (!custody?.reserve_escrow_ends_at)'),
    );

    expect(lookup).toContain(".order('reserve_escrow_ends_at', { ascending: false })");
    expect(lookup).toContain('.limit(1)');
    expect(lookup).toContain('if (custodyError) throw custodyError');
  });
});

describe('gift sender copy delivery', () => {
  it('reports the sender copy outcome from activation instead of firing and forgetting', () => {
    const confirm = endpoint.slice(
      endpoint.indexOf("if (action === 'confirm')"),
      endpoint.indexOf("if (action === 'sender_copy')"),
    );

    expect(endpoint).not.toContain('queueSenderCopy');
    expect(endpoint).not.toContain('EdgeRuntime');
    expect(confirm.match(/deliverSenderCopy\(user/g)).toHaveLength(2);
    expect(confirm.replace(/\s+/g, ' ').match(/senderCopy, recipientEmail,? \}\)/g)).toHaveLength(
      2,
    );
  });

  it('emails the recipient automatically when the card goes live, once', () => {
    const confirm = endpoint.slice(
      endpoint.indexOf("if (action === 'confirm')"),
      endpoint.indexOf("if (action === 'resume')"),
    );
    expect(confirm.match(/deliverRecipientInvitation\(user/g)).toHaveLength(2);
    const deliver = endpoint.slice(
      endpoint.indexOf('async function deliverRecipientInvitation'),
      endpoint.indexOf('async function escrowTransferProven'),
    );
    expect(deliver).toContain(".eq('action', 'gift.notified')");
    expect(deliver).toContain("status: 'failed'");
  });

  it('keeps a mail failure from failing an activation that already happened', () => {
    const deliver = endpoint.slice(
      endpoint.indexOf('async function deliverSenderCopy'),
      endpoint.indexOf('async function escrowTransferProven'),
    );

    expect(deliver).toContain('try {');
    expect(deliver).toContain("status: 'failed'");
  });

  it('lets only the sender re-send an active card copy, with a daily limit', () => {
    const resend = endpoint.slice(
      endpoint.indexOf("if (action === 'sender_copy')"),
      endpoint.indexOf("if (action !== 'prepare')"),
    );

    expect(resend).toContain(".eq('sender_id', user.id)");
    expect(resend).toContain(".eq('code_hash', await hashGiftCode(code))");
    expect(resend).toContain("card.status !== 'active'");
    expect(resend).toContain('MAX_SENDER_COPIES_PER_DAY');
    expect(resend).toContain('{ force: true }');
  });

  it('bounds the provider request now that callers wait for it', () => {
    const email = source('supabase/functions/_shared/email.ts');
    expect(email).toContain('signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS)');
  });
});

describe('gift setup resume', () => {
  const resume = endpoint.slice(
    endpoint.indexOf("if (action === 'resume')"),
    endpoint.indexOf("if (action === 'sender_copy')"),
  );

  it('lets only the signed-in sender replace the code of a still-pending card', () => {
    expect(resume).toContain(".eq('sender_id', user.id)");
    expect(resume).toContain("card.status !== 'pending_escrow'");
    // Re-checked in the update itself, so a card activated meanwhile keeps its code.
    expect(resume).toContain('.update({ code_hash: await hashGiftCode(code) })');
    expect(resume.slice(resume.indexOf('.update('))).toContain(".eq('status', 'pending_escrow')");
    expect(resume).toContain("'gift.code_reissued'");
  });

  it('continues only while the token is with the sender or already in escrow', () => {
    const flat = resume.replace(/\s+/g, ' ');
    expect(flat).toContain("owner === escrowWallet ? 'escrow'");
    expect(flat).toContain("owner === getAddress(card.sender_wallet) ? 'sender'");
    expect(resume).toContain('if (!custody)');
    // Resuming never moves the token; activation still goes through confirm.
    expect(resume).not.toContain('writeAndConfirm');
    expect(resume).not.toContain("status: 'active'");
  });
});
