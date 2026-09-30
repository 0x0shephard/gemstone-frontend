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

  // The recipient is emailed at activation, without pressing anything.
  await expect(alice.page.getByText(`The claim link was emailed to ${bobEmail}.`)).toBeVisible();
  await expect
    .poll(async () => (await emails()).filter((mail) => mail.to.includes(bobEmail)).length)
    .toBe(1);
  const invitation = (await emails()).find((mail) => mail.to.includes(bobEmail));
  expect(invitation?.subject).toMatch(/sent you a gemstone/);
  // "Email again" still resends on request.
  await alice.page.getByRole('button', { name: 'Email again' }).click();
  await expect(alice.page.getByText(`Card sent to ${bobEmail}.`)).toBeVisible();
  const claimUrl = invitation!.text.match(/Claim it here: (\S+)/)![1];
  expect(await nft.ownerOf(tokenId)).toBe(stack.accounts.operator.address);
  await alice.context.close();

  const bob = await actor(browser, stack, 'bob');
  await bob.page.goto(new URL(claimUrl).pathname);
  await connectWallet(bob.page);
  await bob.page.getByRole('button', { name: 'Claim the token' }).click();
  await expect.poll(() => nft.ownerOf(tokenId), { timeout: 60_000 }).toBe(bob.address);

  // Both parties were alerted in the app, not only by email.
  const kinds = async () => {
    const response = await fetch(
      `${stack.supabase.url}/rest/v1/notifications?select=kind,wallet_address&entity_type=eq.gift_card`,
      {
        headers: {
          apikey: stack.supabase.serviceKey,
          authorization: `Bearer ${stack.supabase.serviceKey}`,
        },
      },
    );
    return ((await response.json()) as Array<{ kind: string; wallet_address: string }>).map(
      (row) => `${row.kind}:${row.wallet_address}`,
    );
  };
  await expect
    .poll(kinds)
    .toEqual(
      expect.arrayContaining([
        `gift.sent:${alice.address.toLowerCase()}`,
        `gift.received:${bob.address.toLowerCase()}`,
        `gift.claimed:${alice.address.toLowerCase()}`,
      ]),
    );
  await bob.context.close();
});
