import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a holder lists a token and another collector buys it', async ({ browser, stack }) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceTokenTwo);
  const gemId = await nft.gemOf(tokenId);

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${gemId}`);
  await connectWallet(alice.page);
  await alice.page.getByRole('button', { name: 'List for sale' }).click();
  await alice.page.getByLabel('List price (USD)').fill('1000');
  await alice.page.getByRole('button', { name: /^List at \$/ }).click();
  await tapThroughSteps(
    alice.page,
    async () => (await nft.ownerOf(tokenId)) === String(stack.deployment.Marketplace),
  );
  await expect.poll(() => nft.ownerOf(tokenId)).toBe(String(stack.deployment.Marketplace));
  await alice.context.close();

  const bob = await actor(browser, stack, 'bob');
  await bob.page.goto(`/gem/${gemId}`);
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Buy now' }).click();
  await bob.page.getByRole('button', { name: /^ETH/ }).click();
  await bob.page.getByRole('button', { name: /^Pay \$/ }).click();
  await tapThroughSteps(bob.page, async () => (await nft.ownerOf(tokenId)) === bob.address);
  expect(await nft.ownerOf(tokenId)).toBe(bob.address);
  await bob.context.close();
});
