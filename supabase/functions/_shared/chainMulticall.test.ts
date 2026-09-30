import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('operator chain definition', () => {
  it('declares Multicall3 so multicall reads (the auction sweep) can run', () => {
    const chain = readFileSync(join(process.cwd(), 'supabase/functions/_shared/chain.ts'), 'utf8');
    const definition = chain.slice(
      chain.indexOf('defineChain({'),
      chain.indexOf('return { chain, chainId }'),
    );
    expect(definition).toContain('multicall3');
    expect(definition).toContain('0xcA11bde05977b3631167028862bE2a173976CA11');
    expect(definition).toContain("Deno.env.get('MULTICALL3_ADDRESS')");
  });
});
