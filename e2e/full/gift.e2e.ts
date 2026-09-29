import {
  actor,
  clearEmails,
  connectWallet,
  emails,
  expect,
  tapThroughSteps,
  test,
} from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('a gift card is escrowed, emailed to both parties and claimed by the recipient', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceGiftToken);
  const gemId = await nft.gemOf(tokenId);
  const bobEmail = stack.users.bob.email;
  await clearEmails();

  const alice = await actor(browser, stack, 'alice');
  await alice.page.goto(`/gem/${gemId}`);
  await connectWallet(alice.page);
  await alice.page.getByRole('button', { name: 'Send token' }).click();
  await alice.page.getByRole('button', { name: /Make a gift card/ }).click();
  await alice.page.getByLabel('Recipient email').fill(bobEmail);
  await alice.page.getByRole('button', { name: 'Continue with gift card' }).click();
  await alice.page.getByRole('button', { name: 'Transfer to escrow' }).click();
  await tapThroughSteps(alice.page, alice.page.getByRole('heading', { name: 'Gift card ready' }));

  // The sender copy is reported truthfully and actually sent.
  await expect(
    alice.page.getByText('A printable QR copy was emailed to your account.'),
  ).toBeVisible();
  await expect
    .poll(async () => (await emails()).some((mail) => mail.to.includes(stack.users.alice.email)))
    .toBe(true);

  await alice.page.getByRole('button', { name: 'Email the recipient' }).click();
  await expect(alice.page.getByText(`Card sent to ${bobEmail}.`)).toBeVisible();
  const invitation = (await emails()).find((mail) => mail.to.includes(bobEmail));
  expect(invitation?.subject).toMatch(/sent you a gemstone/);
  const claimUrl = invitation!.text.match(/Claim it here: (\S+)/)![1];
  expect(await nft.ownerOf(tokenId)).toBe(stack.accounts.operator.address);
  await alice.context.close();

  const bob = await actor(browser, stack, 'bob');
  await bob.page.goto(new URL(claimUrl).pathname);
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Claim the token' }).click();
  await expect.poll(() => nft.ownerOf(tokenId), { timeout: 60_000 }).toBe(bob.address);
  await bob.context.close();
});
