import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

async function prepareGift(page: import('@playwright/test').Page, gemId: bigint, email: string) {
  await page.goto(`/gem/${gemId}`);
  await connectWallet(page);
  await page.getByRole('button', { name: 'Send token' }).click();
  await page.getByRole('button', { name: /Make a gift card/ }).click();
  await page.getByLabel('Recipient email').fill(email);
  await page.getByRole('button', { name: 'Continue with gift card' }).click();
  await expect(page.getByRole('button', { name: 'Transfer to escrow' })).toBeVisible();
}

test('an abandoned setup does not block a new gift for the same token', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const gemId = await nft.gemOf(BigInt(stack.deployment.aliceGiftToken));

  const first = await actor(browser, stack, 'alice');
  await prepareGift(first.page, gemId, stack.users.bob.email);
  await first.context.close();

  // Was a 409 ("already has a pending or active gift") until the stale setup was retired.
  const second = await actor(browser, stack, 'alice');
  await prepareGift(second.page, gemId, stack.users.bob.email);
  await expect(second.page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await second.context.close();
});

test('an interrupted gift is finished from a new tab without a second transfer', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceResumeToken);
  const operator = stack.accounts.operator.address;

  const lost = await actor(browser, stack, 'alice');
  await prepareGift(lost.page, await nft.gemOf(tokenId), stack.users.bob.email);
  await lost.context.close();
  // The wallet completed the escrow transfer after the tab (and its code) was gone.
  await nft.transferAs(lost.address, operator, tokenId);

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto('/profile?tab=gifts');
  await connectWallet(alice.page);
  // The token sits in escrow, so the card is named by token rather than by holding.
  await alice.page
    .locator('div', { hasText: `Token #${tokenId}` })
    .filter({ has: alice.page.getByRole('button', { name: 'Finish gift card' }) })
    .last()
    .getByRole('button', { name: 'Finish gift card' })
    .click();
  await tapThroughSteps(alice.page, alice.page.getByRole('heading', { name: 'Gift card ready' }));

  await expect(
    alice.page.getByText('A printable QR copy was emailed to your account.'),
  ).toBeVisible();
  expect(await nft.ownerOf(tokenId)).toBe(operator);
  const calls = await alice.page.evaluate(
    () => (window as unknown as { __e2eWallet: { calls: string[] } }).__e2eWallet.calls,
  );
  expect(calls).not.toContain('eth_sendTransaction');
  await alice.context.close();
});
