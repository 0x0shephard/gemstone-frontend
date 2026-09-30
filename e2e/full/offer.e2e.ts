import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a collector offers on an unlisted token and the holder accepts', async ({
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
  await alice.context.close();
});
