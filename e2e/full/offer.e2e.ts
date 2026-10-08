import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a collector offers on an unlisted token, the holder accepts, and a bid can be withdrawn', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceOfferToken);
  const gemId = await nft.gemOf(tokenId);

  const bob = await actor(browser, stack, 'bob');
  await bob.page.goto(`/gem/${gemId}`);
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Make an offer' }).click();
  const dialog = bob.page.getByRole('dialog');
  await dialog.getByLabel('Offer amount (USD)').fill('1200');
  await dialog.getByRole('button', { name: /^ETH/ }).click();
  await dialog.getByRole('button', { name: /^Submit offer · \$/ }).click();
  await tapThroughSteps(bob.page, () => dialog.getByRole('button', { name: /^Done/ }).isVisible());
  await bob.context.close();

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto('/profile?tab=offers');
  await connectWallet(alice.page);
  await alice.page.getByRole('button', { name: 'Accept', exact: true }).click();
  await tapThroughSteps(alice.page, async () => (await nft.ownerOf(tokenId)) === bob.address);
  expect(await nft.ownerOf(tokenId)).toBe(bob.address);

  // Alice bids on the token Bob now holds, then withdraws it before it expires.
  await alice.page.goto(`/gem/${gemId}`);
  await alice.page.getByRole('button', { name: 'Make an offer' }).click();
  const offerDialog = alice.page.getByRole('dialog');
  await offerDialog.getByLabel('Offer amount (USD)').fill('1300');
  await offerDialog.getByRole('button', { name: /^ETH/ }).click();
  await offerDialog.getByRole('button', { name: /^Submit offer · \$/ }).click();
  await tapThroughSteps(alice.page, () =>
    offerDialog.getByRole('button', { name: /^Done/ }).isVisible(),
  );
  await alice.page.goto('/profile?tab=offers');
  const escrowed = await nft.ethBalance(alice.address);
  await alice.page.getByRole('button', { name: 'Withdraw bid' }).click();
  // The refund (about 0.65 ETH) dwarfs the gas, so the balance rises only if
  // the escrow really came back.
  await tapThroughSteps(alice.page, async () => (await nft.ethBalance(alice.address)) > escrowed);
  await alice.context.close();
});
