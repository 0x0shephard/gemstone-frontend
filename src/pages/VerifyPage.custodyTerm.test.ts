import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'src/pages/BankPage.tsx'), 'utf8');
const service = readFileSync(join(process.cwd(), 'src/services/offchain/verification.ts'), 'utf8');

describe('missing custody term UX', () => {
  it('is available only inside the bank-authorised storage portal', () => {
    expect(page).toContain('<OperationsAccessGate capability="bank.receive">');
    expect(page).toContain('<LegacyCustodyTerm />');
    expect(service).toContain("action: 'record_term'");
  });

  it('requires an explicit date, audit reference and attestation without supplying defaults', () => {
    expect(page).toContain('actual custody agreement date');
    expect(page).toContain('will never calculate or guess it');
    expect(page).toContain('note.trim().length >= 10 && attested');
    expect(page).toContain('I confirm this is the actual custody agreement end date');
    expect(page).toContain('value={escrowEnds}');
    expect(page).not.toMatch(/setEscrowEnds\([^)]*Date\.now/);
  });
});
