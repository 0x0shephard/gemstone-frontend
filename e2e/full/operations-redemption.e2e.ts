import type { Page } from '@playwright/test';
import {
  actor,
  clearEmails,
  connectWallet,
  emails,
  expect,
  selectByText,
  tapThroughSteps,
  test,
} from '../fixtures/stack';
import { chain } from '../fixtures/chain';

const evidenceFile = {
  name: 'e2e-evidence.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% Digital Carat local E2E evidence\n'),
};

async function uploadEvidence(page: Page, label: string) {
  const form = page.getByText(label, { exact: true }).locator('xpath=ancestor::form[1]');
  await form.locator('input[type="file"]').setInputFiles(evidenceFile);
  // Choosing the file uploads it.
  await expect(form.getByText(/uploaded and verified/)).toBeVisible();
}

async function chooseRequest(page: Page, name: RegExp) {
  const request = page.getByRole('button', { name }).first();
  await expect(request).toBeVisible();
  await request.click();
}

function fieldInput(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=..').locator('input');
}

test('acceptance, bank release, custodian delivery, the holder code and the burn follow the six-step lifecycle', async ({
  browser,
  stack,
}) => {
  test.setTimeout(300_000);
  await clearEmails();
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceRedeemToken);
  const gemId = await nft.gemOf(tokenId);
  const requestName = new RegExp(`Token #${tokenId}`);

  // 1. On-chain request.
  const owner = await actor(browser, stack, 'alice');
  await owner.page.goto(`/gem/${gemId}`);
  await connectWallet(owner.page);
  await owner.page.getByRole('button', { name: 'Redeem physical gemstone' }).click();
  await owner.page.getByLabel('Preferred pickup location').fill('E2E Geneva vault');
  await owner.page.getByRole('button', { name: 'Request redemption' }).click();
  await tapThroughSteps(owner.page, owner.page.getByText('Redemption request recorded'));
  await expect(
    owner.page.getByText('Request open · awaiting Digital Carat acceptance'),
  ).toBeVisible();
  await owner.context.close();

  // ... Digital Carat accepts it. These seeded gems have no seller-cycle bank
  // receipt, so the admin names the storing bank as well as the custodian.
  const admin = await actor(browser, stack, 'admin');
  await admin.page.goto('/verify');
  await admin.page.getByRole('button', { name: /Redemption lifecycles/ }).click();
  await chooseRequest(admin.page, requestName);
  await selectByText(
    admin.page.getByText('Storage bank', { exact: true }).locator('xpath=..').locator('select'),
    'E2E Bank',
  );
  await selectByText(
    admin.page
      .getByText('Delivery custodian', { exact: true })
      .locator('xpath=..')
      .locator('select'),
    'E2E Custodian',
  );
  await admin.page.getByRole('button', { name: 'Accept request' }).click();
  await expect(admin.page.getByRole('button', { name: 'Accept request' })).toBeHidden();
  await admin.context.close();

  // 2-3. The storing bank confirms it holds the stone and dispatches it. The
  // server signs the on-chain step, so bank staff never connect a wallet.
  const bank = await actor(browser, stack, 'bank');
  await bank.page.goto('/bank');
  await bank.page.getByRole('button', { name: /Redemptions/ }).click();
  await chooseRequest(bank.page, requestName);
  await bank.page.getByRole('button', { name: 'Confirm stone is in storage' }).click();

  await uploadEvidence(bank.page, 'Record dispatch from the bank evidence');
  await fieldInput(bank.page, 'Dispatched at').fill('2026-10-08T01:05');
  await fieldInput(bank.page, 'Carrier, optional').fill('E2E secure transport');
  await bank.page.getByRole('button', { name: 'Record dispatch', exact: true }).click();
  await expect(
    bank.page.getByText(/Dispatched\. The custodian records the delivery/),
  ).toBeVisible();
  await bank.context.close();

  // 4. The custodian delivers to the pickup point; that releases the holder's code.
  const custodian = await actor(browser, stack, 'custodian');
  await custodian.page.goto('/custodian');
  await chooseRequest(custodian.page, requestName);
  await uploadEvidence(custodian.page, 'Record delivery at the pickup point evidence');
  await fieldInput(custodian.page, 'Arrived at').fill('2026-10-08T01:10');
  await fieldInput(custodian.page, 'Pickup point').fill('E2E Geneva vault');
  await custodian.page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(custodian.page.getByText(/The customer has their code/)).toBeVisible({
    timeout: 60_000,
  });
  await custodian.context.close();

  // 5. The holder confirms the handover with the emailed code, and 6. burns.
  const finalOwner = await actor(browser, stack, 'alice');
  await finalOwner.page.goto('/redeem');
  await connectWallet(finalOwner.page);
  await expect.poll(async () => (await emails()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const codeMessage = (await emails()).find((message) =>
    message.subject?.includes('redemption authorization code'),
  );
  expect(codeMessage).toBeTruthy();
  const code = codeMessage!.text.match(/code is ([A-Z0-9-]+)/)?.[1];
  expect(code).toBeTruthy();
  await finalOwner.page.getByLabel('Handover code').fill(code!);
  await finalOwner.page.getByRole('button', { name: 'Confirm handover' }).click();

  const burn = finalOwner.page.getByRole('button', { name: 'Burn token and complete redemption' });
  await expect(burn).toBeVisible();
  await burn.click();
  await tapThroughSteps(
    finalOwner.page,
    finalOwner.page.getByRole('button', { name: 'View receipt' }),
  );
  await expect.poll(() => nft.exists(tokenId), { timeout: 30_000 }).toBe(false);
  await finalOwner.page.reload();
  await expect(finalOwner.page.getByText('Redeemed').first()).toBeVisible();

  // The remaining reserve is credited to the holder, not the custodian.
  const before = await nft.ethBalance(finalOwner.address);
  await finalOwner.page.goto('/profile');
  await finalOwner.page.getByRole('button', { name: 'Claim ETH' }).click();
  await tapThroughSteps(
    finalOwner.page,
    async () => (await nft.ethBalance(finalOwner.address)) > before,
  );
  await finalOwner.context.close();
});
