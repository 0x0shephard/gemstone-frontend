import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { installTestWallet } from './testWallet';

type Role = 'seller' | 'alice' | 'bob';

export interface StackState {
  rpc: string;
  site: string;
  deployment: Record<string, string | number>;
  supabase: { url: string; anonKey: string; serviceKey: string };
  accounts: Record<string, { address: string; key: string }>;
  users: Record<Role, { id: string; email: string; password: string }>;
}

export function readStack(): StackState {
  const file = path.resolve(import.meta.dirname, '../.stack/state.json');
  if (!fs.existsSync(file)) {
    throw new Error('Local stack is not running. Start it with `npm run e2e:stack`.');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as StackState;
}

/** Signs `role` in by storing a real Supabase session before the app loads. */
async function signIn(page: Page, stack: StackState, role: Role) {
  const user = stack.users[role];
  const response = await fetch(`${stack.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: stack.supabase.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!response.ok) throw new Error(`Sign-in for ${role} failed: ${await response.text()}`);
  const session = await response.json();
  const storageKey = `sb-${new URL(stack.supabase.url).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: JSON.stringify(session),
  });
}

export async function emails(): Promise<
  Array<{ to: string[]; subject: string; html: string; text: string }>
> {
  return (await fetch('http://127.0.0.1:4010/emails')).json();
}

export async function clearEmails() {
  await fetch('http://127.0.0.1:4010/emails', { method: 'DELETE' });
}

/** A signed-in person with their verified wallet injected, in their own browser context. */
export async function actor(
  browser: import('@playwright/test').Browser,
  stack: StackState,
  role: Role,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installTestWallet(page, { rpcUrl: stack.rpc, account: stack.accounts[role].address });
  await signIn(page, stack, role);
  return { context, page, address: stack.accounts[role].address };
}

export async function connectWallet(page: Page) {
  const connect = page.getByRole('button', { name: /connect wallet/i }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click();
    await page
      .getByRole('button', { name: /browser wallet|metamask/i })
      .first()
      .click();
  }
}

/**
 * Taps through a transaction's wallet steps. Each wallet request needs its own
 * tap (the mobile gesture model), each captioned "Your wallet opens when you tap".
 */
export async function tapThroughSteps(
  page: Page,
  finished: import('@playwright/test').Locator | (() => Promise<boolean>),
) {
  const done = () =>
    typeof finished === 'function' ? finished() : finished.isVisible().catch(() => false);
  // The gesture button's label names the step; its caption is constant.
  const step = page.locator('div:has(> p:text-matches("Your wallet opens when you tap")) > button');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await done()) return;
    const next = step.first();
    if (
      (await next.isVisible().catch(() => false)) &&
      (await next.isEnabled().catch(() => false))
    ) {
      await next.click();
    }
    await page.waitForTimeout(750);
  }
  throw new Error('Transaction did not finish after tapping through its steps');
}

export const dialogClosed = (page: Page) => async () =>
  !(await page
    .getByRole('dialog')
    .isVisible()
    .catch(() => false));

/** Picks the `<option>` whose text contains `text` (labels carry generated ids). */
export async function selectByText(select: import('@playwright/test').Locator, text: string) {
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  if (value === null) throw new Error(`No option containing "${text}"`);
  await select.selectOption(value);
}

export const test = base.extend<{ stack: StackState }>({
  // eslint-disable-next-line no-empty-pattern
  stack: async ({}, use) => use(readStack()),
});
export { expect };
