import { actor, expect, test } from '../fixtures/stack';
import { chain } from '../fixtures/chain';

test('the vault custodian is disclosed and can extend a stone’s custody agreement', async ({
  browser,
  stack,
}) => {
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const gemId = await nft.gemOf(BigInt(stack.deployment.aliceKeptToken));

  // Anyone viewing the stone sees who holds it and where.
  const visitor = await actor(browser, stack, 'bob');
  await visitor.page.goto(`/gem/${gemId}`);
  await expect(visitor.page.getByText('E2E Bank').first()).toBeVisible();
  await expect(visitor.page.getByText(/E2E Bank, E2E Geneva vault/).first()).toBeVisible();
  await visitor.context.close();

  // The vault that holds it records a signed extension; only later dates pass.
  const vault = await actor(browser, stack, 'bank');
  await vault.page.goto('/bank');
  await vault.page.getByRole('button', { name: /Custody agreements/ }).click();
  await vault.page.getByRole('button', { name: new RegExp(`Gemstone #${gemId}`) }).click();
  await vault.page.getByLabel('New agreement end date').fill('2020-01-01');
  await expect(vault.page.getByRole('alert')).toContainText('must be later than the current one');
  await vault.page.getByLabel('New agreement end date').fill('2040-06-30');
  await vault.page
    .getByLabel('Signed amendment reference')
    .fill('Renewal agreement E2E-2040, signed by both parties');
  await vault.page.getByLabel(/This date comes from a signed amendment/).check();
  await vault.page.getByRole('button', { name: 'Record extension' }).click();
  await expect(vault.page.getByText('Extension recorded.')).toBeVisible();
  await expect(vault.page.getByText(/Extended by signed amendment/)).toBeVisible();
  await expect(
    vault.page.getByText('Renewal agreement E2E-2040, signed by both parties'),
  ).toBeVisible();
  await vault.context.close();

  // The public record shows the extended term.
  const viewer = await actor(browser, stack, 'bob');
  await viewer.page.goto(`/gem/${gemId}`);
  await expect(viewer.page.getByText(/· extended/)).toBeVisible();
  await viewer.context.close();
});
