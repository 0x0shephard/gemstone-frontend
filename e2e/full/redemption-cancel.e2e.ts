import {
  actor,
  connectWallet,
  expect,
  selectByText,
  tapThroughSteps,
  test,
} from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('the holder can cancel an accepted redemption until the vault confirms it', async ({
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

  // Digital Carat accepts; the vault has not confirmed yet, so the holder may still cancel.
  const admin = await actor(browser, stack, 'admin');
  await admin.page.goto('/verify');
  await admin.page.getByRole('button', { name: /Redemption lifecycles/ }).click();
  await admin.page
    .getByRole('button', { name: new RegExp(`Token #${tokenId}`) })
    .first()
    .click();
  await selectByText(
    admin.page.getByText('Custodian vault', { exact: true }).locator('xpath=..').locator('select'),
    'E2E Custodian',
  );
  await admin.page.getByRole('button', { name: 'Accept request' }).click();
  await expect(admin.page.getByRole('button', { name: 'Accept request' })).toBeHidden();
  await admin.context.close();

  const holder = await actor(browser, stack, 'alice');
  await holder.page.goto('/redeem');
  await connectWallet(holder.page);
  await holder.page.getByRole('button', { name: 'Prepare cancellation' }).click();
  await holder.page.getByRole('button', { name: 'Cancel redemption in wallet' }).click();
  await tapThroughSteps(holder.page, async () => !(await nft.locked(tokenId)));
  expect(await nft.ownerOf(tokenId)).toBe(holder.address);
  await holder.context.close();
});
