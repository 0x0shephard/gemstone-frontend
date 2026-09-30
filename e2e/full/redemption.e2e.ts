import { actor, connectWallet, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a holder redeems, the custodian hands over, and the holder claims the reserve', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceRedeemToken);
  const gemId = await nft.gemOf(tokenId);

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${gemId}`);
  await connectWallet(alice.page);
  await alice.page.getByRole('button', { name: 'Redeem physical gemstone' }).click();
  await alice.page.getByLabel('Preferred pickup location').fill('Geneva vault');
  await alice.page.getByRole('button', { name: 'Request redemption' }).click();
  await tapThroughSteps(alice.page, () => nft.locked(tokenId));
  await alice.context.close();

  const custodian = await actor(browser, stack, 'custodian');
  await custodian.page.goto('/verify');
  await connectWallet(custodian.page);
  await custodian.page.getByRole('button', { name: 'Confirm handover' }).click();
  await tapThroughSteps(custodian.page, async () => !(await nft.exists(tokenId)));
  await custodian.context.close();

  // The remaining reserve is credited to the holder, not the custodian.
  const holder = await actor(browser, stack, 'alice');
  const before = await nft.ethBalance(holder.address);
  await holder.page.goto('/profile');
  await connectWallet(holder.page);
  await holder.page.getByRole('button', { name: 'Claim ETH' }).click();
  await tapThroughSteps(holder.page, async () => (await nft.ethBalance(holder.address)) > before);
  await holder.context.close();
});
