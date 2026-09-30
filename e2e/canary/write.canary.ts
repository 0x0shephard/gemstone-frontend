import { expect, test } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { installTestWallet } from '../fixtures/testWallet';
import { connectWallet, tapThroughSteps } from '../fixtures/stack';

/**
 * Live write cycle: a dedicated canary account gifts its own token to Resend's
 * test inbox, the token really moves into escrow on Sepolia, the recipient
 * email is really sent, and cancellation returns the token. Leaves the
 * platform as it found it. Skipped unless every canary secret is configured:
 *
 *   CANARY_PRIVATE_KEY     Sepolia key of the canary wallet (holds ETH and the gem's token)
 *   CANARY_GEM_ID          gem whose token the canary wallet owns, with a positive reserve
 *   CANARY_EMAIL / CANARY_PASSWORD   the canary's Digital Carat account (wallet verified)
 *   CANARY_SUPABASE_URL / CANARY_SUPABASE_ANON_KEY   the live project's public values
 */

const SITE = process.env.CANARY_SITE ?? 'https://digitalcarat.io';
const RPC = process.env.CANARY_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const env = {
  key: process.env.CANARY_PRIVATE_KEY as Hex | undefined,
  gemId: process.env.CANARY_GEM_ID,
  email: process.env.CANARY_EMAIL,
  password: process.env.CANARY_PASSWORD,
  supabaseUrl: process.env.CANARY_SUPABASE_URL,
  anonKey: process.env.CANARY_SUPABASE_ANON_KEY,
};

test('live gift write cycle: escrow, email, cancel and return', async ({ page }) => {
  test.skip(
    Object.values(env).some((value) => !value),
    'canary secrets not configured',
  );
  test.setTimeout(8 * 60_000);
  const account = privateKeyToAccount(env.key!);

  const session = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.email, password: env.password }),
  }).then((response) => response.json());
  const storageKey = `sb-${new URL(env.supabaseUrl!).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: JSON.stringify(session),
  });
  await installTestWallet(page, { rpcUrl: RPC, account: account.address, privateKey: env.key });

  await page.goto(`${SITE}/gem/${env.gemId}`);
  await connectWallet(page);
  await page.getByRole('button', { name: 'Send token' }).click();
  await page.getByRole('button', { name: /Make a gift card/ }).click();
  await page.getByLabel('Recipient email').fill('delivered@resend.dev');
  await page.getByRole('button', { name: 'Continue with gift card' }).click();
  await page.getByRole('button', { name: 'Transfer to escrow' }).click();
  await tapThroughSteps(page, page.getByRole('heading', { name: 'Gift card ready' }));
  await expect(page.getByText('A printable QR copy was emailed to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Email the recipient' }).click();
  await expect(page.getByText('Card sent to delivered@resend.dev.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Put everything back: cancelling returns the token from escrow.
  await page.goto(`${SITE}/profile?tab=gifts`);
  await connectWallet(page);
  await page.getByRole('button', { name: 'Cancel and return token' }).first().click();
  await expect(page.getByText(/Cancelled|Return transfer pending/).first()).toBeVisible({
    timeout: 3 * 60_000,
  });
});
