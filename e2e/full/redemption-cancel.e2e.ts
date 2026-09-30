import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('the custodian can cancel a redemption request, unlocking the token', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceCancelToken);

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${await nft.gemOf(tokenId)}`);
  await connectWallet(alice.page);
  await alice.page.getByRole('button', { name: 'Redeem physical gemstone' }).click();
  await alice.page.getByLabel('Preferred pickup location').fill('Geneva vault');
  await alice.page.getByRole('button', { name: 'Request redemption' }).click();
  await tapThroughSteps(alice.page, () => nft.locked(tokenId));
  await alice.context.close();

  // The portal offered this before the contract allowed it; it now must succeed.
  const custodian = await actor(browser, stack, 'custodian');
  await custodian.page.goto('/verify');
  await connectWallet(custodian.page);
  await custodian.page.getByRole('button', { name: 'Cancel redemption' }).click();
  await tapThroughSteps(custodian.page, async () => !(await nft.locked(tokenId)));
  expect(await nft.ownerOf(tokenId)).toBe(alice.address);
  await custodian.context.close();
});
