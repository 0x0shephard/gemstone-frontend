import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

type WalletControl = { rejectNext(method: string): void; loseNextResponse(method: string): void };

test('a rejection in the wallet leaves the token in place and the action retryable', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceKeptToken);
  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${await nft.gemOf(tokenId)}`);
  await connectWallet(alice.page);

  await alice.page.getByRole('button', { name: 'List for sale' }).click();
  await alice.page.getByLabel('List price (USD)').fill('1000');
  await alice.page.evaluate(() =>
    (window as unknown as { __e2eWallet: WalletControl }).__e2eWallet.rejectNext(
      'eth_sendTransaction',
    ),
  );
  await alice.page.getByRole('button', { name: /^List at \$/ }).click();
  const dialog = alice.page.getByRole('dialog');
  await tapThroughSteps(alice.page, () => dialog.getByRole('alert').isVisible());

  await expect(dialog.getByRole('alert')).toContainText(/reject/i);
  expect(await nft.ownerOf(tokenId)).toBe(alice.address);
  await expect(dialog.getByRole('button', { name: /^List at \$/ })).toBeEnabled();
  await alice.context.close();
});

test('a lost wallet reply after broadcast never offers a second send', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceFaultToken);
  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${await nft.gemOf(tokenId)}`);
  await connectWallet(alice.page);

  await alice.page.getByRole('button', { name: 'Send token' }).click();
  await alice.page.getByRole('button', { name: /Send to wallet address/ }).click();
  await alice.page.getByLabel('Recipient wallet address').fill(stack.accounts.bob.address);
  await alice.page.evaluate(() =>
    (window as unknown as { __e2eWallet: WalletControl }).__e2eWallet.loseNextResponse(
      'eth_sendTransaction',
    ),
  );
  const dialog = alice.page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Send token' }).click();
  await tapThroughSteps(alice.page, () => dialog.getByRole('alert').isVisible());

  // The transfer did happen, and the app must not invite paying for it twice.
  await expect.poll(() => nft.ownerOf(tokenId)).toBe(stack.accounts.bob.address);
  await expect(dialog.getByRole('button', { name: 'Send token' })).toHaveCount(0);
  await alice.context.close();
});
