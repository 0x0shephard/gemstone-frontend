import { actor, connectWallet, expect, tapThroughSteps, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a bid on a listed gem wins its 24-hour auction and mints the token', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const bob = await actor(browser, stack, 'bob');
  const before = await nft.balanceOf(bob.address);

  await bob.page.goto(`/gem/${stack.deployment.listedGem}`);
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Place bid' }).click();
  const dialog = bob.page.getByRole('dialog');
  await dialog.getByLabel('Bid amount (USD)').fill('1000');
  await dialog.getByRole('button', { name: /^ETH/ }).click();
  await dialog.getByRole('button', { name: /^Place bid · \$/ }).click();
  await tapThroughSteps(bob.page, () => dialog.getByRole('button', { name: /^Done/ }).isVisible());
  await bob.context.close();

  // Past the auction close; the scheduled sweep settles it exactly as cron would.
  // Snapshotted first: later journeys set expiries from the browser clock and
  // must not run on a chain that is a day ahead of it.
  const beforeTravel = await nft.snapshot();
  test.info().attach('chain-snapshot', { body: beforeTravel });
  await nft.travel(24 * 60 * 60 + 120);
  const admin = stack.accounts.admin.address;
  await nft.refreshFeed(admin, String(stack.deployment.EthUsdFeed));
  await nft.refreshFeed(admin, String(stack.deployment.UsdcUsdFeed));
  const sweep = await fetch(`${stack.supabase.url}/functions/v1/v1-auction-refresh`, {
    method: 'POST',
    headers: { 'x-auction-refresh-secret': 'e2e', 'content-type': 'application/json' },
    body: '{}',
  });
  const report = await sweep.text();
  expect(sweep.status, report).toBe(200);
  test.info().annotations.push({ type: 'sweep', description: report });
  try {
    await expect.poll(() => nft.balanceOf(bob.address)).toBe(before + 1n);
  } finally {
    await nft.restore(beforeTravel);
  }
});
