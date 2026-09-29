import {
  actor,
  connectWallet,
  expect,
  selectByText,
  tapThroughSteps,
  test,
} from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('two collectors swap tokens end to end', async ({ browser, stack }) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const aliceToken = BigInt(stack.deployment.aliceTokenOne);
  const bobToken = BigInt(stack.deployment.bobToken);

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto('/swaps');
  await connectWallet(alice.page);
  const offered = alice.page.getByRole('combobox').first();
  await expect(offered.locator('option', { hasText: 'Alice Sapphire' })).toHaveCount(1);
  await selectByText(offered, 'Alice Sapphire');
  await alice.page.getByRole('button', { name: 'Build swap offer' }).click();

  const receive = alice.page.getByRole('dialog').getByRole('combobox').first();
  // The viewer's own other tokens must never be offered as the thing they receive.
  // Wait for the list to load, then check the viewer's own token is absent.
  await expect(receive.locator('option', { hasText: 'Bob Spinel' })).toHaveCount(1);
  await expect(receive.locator('option', { hasText: 'Alice Topaz' })).toHaveCount(0);
  await selectByText(receive, 'Bob Spinel');
  await alice.page.getByRole('button', { name: 'Propose swap' }).click();
  const done = alice.page.getByRole('dialog').getByRole('button', { name: 'Done' });
  await tapThroughSteps(alice.page, done);
  await done.click();
  await expect(alice.page.getByRole('dialog')).toBeHidden();
  await alice.context.close();

  const bob = await actor(browser, stack, 'bob');
  await bob.page.goto('/swaps');
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Accept swap' }).click();
  await tapThroughSteps(bob.page, async () => (await nft.ownerOf(aliceToken)) === bob.address);
  await expect.poll(() => nft.ownerOf(aliceToken)).toBe(bob.address);
  expect(await nft.ownerOf(bobToken)).toBe(alice.address);
  await bob.context.close();
});
