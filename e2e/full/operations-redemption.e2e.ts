import type { Locator, Page } from '@playwright/test';
import {
  actor,
  clearEmails,
  connectWallet,
  emails,
  expect,
  selectByText,
  tapThroughSteps,
  test,
} from '../fixtures/stack';
import { chain } from '../fixtures/chain';

const evidenceFile = {
  name: 'e2e-evidence.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% Digital Carat local E2E evidence\n'),
};

async function uploadEvidence(page: Page, label: string) {
  const form = page.getByText(label, { exact: true }).locator('xpath=ancestor::form[1]');
  await form.locator('input[type="file"]').setInputFiles(evidenceFile);
  await form.getByRole('button', { name: 'Upload evidence' }).click();
}

async function chooseRequest(page: Page, name: RegExp) {
  const request = page.getByRole('button', { name }).first();
  await expect(request).toBeVisible();
  await request.click();
}

function fieldInput(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=..').locator('input');
}

async function finishWalletSteps(page: Page, done: Locator) {
  const preparedConfirmation = page.getByRole('button', {
    name: /(?:confirm|approve).*in wallet/i,
  });
  await expect(preparedConfirmation).toBeVisible();
  await preparedConfirmation.click();
  await tapThroughSteps(page, done);
  await expect(done).toBeVisible();
  await done.click();
}

test('pickup assignment, custody proof, owner code and final burn use the canonical lifecycle', async ({
  browser,
  stack,
}) => {
  test.setTimeout(300_000);
  await clearEmails();
  const nft = chain(stack.rpc, String(stack.deployment.DGENFT));
  const tokenId = BigInt(stack.deployment.aliceRedeemToken);
  const gemId = await nft.gemOf(tokenId);
  const requestName = new RegExp(`Token #${tokenId}`);

  if (process.env.E2E_RESUME_OPERATIONS !== '1') {
    const owner = await actor(browser, stack, 'alice');
    await owner.page.goto(`/gem/${gemId}`);
    await connectWallet(owner.page);
    await owner.page.getByRole('button', { name: 'Redeem physical gemstone' }).click();
    await owner.page.getByLabel('Preferred pickup location').fill('E2E Geneva vault');
    await owner.page.getByRole('button', { name: 'Request redemption' }).click();
    await tapThroughSteps(owner.page, owner.page.getByText('Redemption request recorded'));
    await expect(
      owner.page.getByText('Request open · awaiting custodian fulfillment'),
    ).toBeVisible();
    await owner.page.getByRole('button', { name: 'Close', exact: true }).click();

    await owner.page.goto('/redeem');
    await expect(
      owner.page.getByRole('heading', { name: 'Identity evidence for pickup' }),
    ).toBeVisible();
    await uploadEvidence(owner.page, 'Owner pickup identity evidence');
    await expect(owner.page.getByText(/Verified identity evidence is available/)).toBeVisible();
    await owner.context.close();

    const admin = await actor(browser, stack, 'admin');
    await admin.page.goto('/verify');
    await admin.page.getByRole('button', { name: /Redemption lifecycles/ }).click();
    await chooseRequest(admin.page, requestName);
    await selectByText(
      admin.page.getByText('Assigned custodian').locator('xpath=..').locator('select'),
      'E2E Custodian',
    );
    await selectByText(
      admin.page.getByText('Assigned storage bank').locator('xpath=..').locator('select'),
      'E2E Bank',
    );
    await admin.page.getByRole('button', { name: 'Assign fulfillment teams' }).click();
    await expect(admin.page.getByRole('button', { name: 'Update assignment' })).toBeVisible();
    await admin.context.close();
  }

  if (process.env.E2E_RESUME_OWNER !== '1') {
    const custodian = await actor(browser, stack, 'custodian');
    await custodian.page.goto('/custodian');
    await connectWallet(custodian.page);
    await chooseRequest(custodian.page, requestName);
    const alreadyDispatched = await custodian.page
      .getByRole('button', {
        name: /custodian dispatched|bank received|pickup handover recorded|pickup proof submitted|proof approved|owner authorized|chain burned/i,
      })
      .isVisible()
      .catch(() => false);
    if (!alreadyDispatched) {
      const dispatchHeading = custodian.page.getByRole('heading', {
        name: 'Record secure dispatch',
      });
      const preparedHeading = custodian.page.getByRole('heading', {
        name: 'Wallet confirmation required',
      });
      const collectionLabel = custodian.page.getByText('Record physical collection evidence', {
        exact: true,
      });
      await expect(dispatchHeading.or(preparedHeading).or(collectionLabel)).toBeVisible();
      if (!(await dispatchHeading.isVisible().catch(() => false))) {
        const restoredCollection = await preparedHeading.isVisible().catch(() => false);
        if (!restoredCollection) {
          await uploadEvidence(custodian.page, 'Record physical collection evidence');
          await expect(custodian.page.getByText(/Verified evidence/)).toBeVisible();
          await fieldInput(custodian.page, 'Collected at').fill('2026-10-05T01:00');
          await fieldInput(custodian.page, 'Collection location').fill('E2E origin vault');
          await custodian.page
            .getByRole('button', { name: 'Prepare collection transaction' })
            .click();
        }
        await finishWalletSteps(
          custodian.page,
          custodian.page.getByRole('button', { name: 'Return to request' }),
        );
      }

      await expect(dispatchHeading).toBeVisible();
      await uploadEvidence(custodian.page, 'Record secure dispatch evidence');
      await expect(custodian.page.getByText(/Verified evidence/)).toBeVisible();
      await fieldInput(custodian.page, 'Dispatched at').fill('2026-10-05T01:05');
      await fieldInput(custodian.page, 'Carrier, optional').fill('E2E secure transport');
      await custodian.page.getByRole('button', { name: 'Record dispatch' }).click();
      await expect(custodian.page.getByText(/No custodian action is legal/)).toBeVisible();
    }
    await custodian.context.close();

    const bank = await actor(browser, stack, 'bank');
    await bank.page.goto('/bank');
    await bank.page.getByRole('button', { name: /Redemption arrivals/ }).click();
    await chooseRequest(bank.page, requestName);
    const bankComplete = await bank.page
      .getByRole('button', {
        name: /pickup handover recorded|pickup proof submitted|proof approved|owner authorized|chain burned/i,
      })
      .isVisible()
      .catch(() => false);
    const receivedRequest = bank.page.getByRole('button', { name: /bank received/i });
    if (!bankComplete) {
      if (!(await receivedRequest.isVisible().catch(() => false))) {
        await uploadEvidence(bank.page, 'Upload arrival evidence');
        await fieldInput(bank.page, 'Bank location').fill('E2E Geneva vault');
        await fieldInput(bank.page, 'Received at').fill('2026-10-05T01:10');
        await bank.page.getByRole('button', { name: 'Record bank arrival' }).click();
        await expect(receivedRequest).toBeVisible();
      }
      await receivedRequest.click();
      await expect(
        bank.page.getByRole('heading', { name: 'Record witnessed pickup' }),
      ).toBeVisible();
      await fieldInput(bank.page, 'Collected at').fill('2026-10-05T01:15');
      await fieldInput(bank.page, 'Name shown on handover evidence').fill('Alice');
      await selectByText(
        bank.page.getByLabel('Owner identity evidence'),
        'verified identity evidence',
      );
      await uploadEvidence(bank.page, 'Upload signed handover evidence');
      await bank.page.getByRole('button', { name: 'Record witnessed pickup' }).click();
      await expect(bank.page.getByText(/pickup handover recorded/i)).toBeVisible();
    }
    await bank.context.close();

    const pickupProof = await actor(browser, stack, 'custodian');
    await pickupProof.page.goto('/custodian');
    await connectWallet(pickupProof.page);
    await chooseRequest(pickupProof.page, requestName);
    const proofComplete = await pickupProof.page
      .getByRole('button', {
        name: /pickup proof submitted|proof approved|owner authorized|chain burned/i,
      })
      .isVisible()
      .catch(() => false);
    if (!proofComplete) {
      await pickupProof.page
        .getByRole('button', { name: 'Prepare pickup proof transaction' })
        .click();
      await finishWalletSteps(
        pickupProof.page,
        pickupProof.page.getByRole('button', { name: 'Return to request' }),
      );
    }
    await pickupProof.context.close();

    const approver = await actor(browser, stack, 'admin');
    await approver.page.goto('/verify');
    await connectWallet(approver.page);
    await approver.page.getByRole('button', { name: /Redemption lifecycles/ }).click();
    await chooseRequest(approver.page, requestName);
    const approvalComplete = await approver.page
      .getByRole('button', { name: /proof approved|owner authorized|chain burned/i })
      .isVisible()
      .catch(() => false);
    if (!approvalComplete) {
      await approver.page.getByRole('button', { name: 'Prepare delivery proof approval' }).click();
      await finishWalletSteps(
        approver.page,
        approver.page.getByRole('button', { name: 'Return to tracker' }),
      );
    }
    await approver.context.close();
  }

  const finalOwner = await actor(browser, stack, 'alice');
  await finalOwner.page.goto('/redeem');
  await connectWallet(finalOwner.page);
  const burn = finalOwner.page.getByRole('button', { name: 'Burn token and complete redemption' });
  const resend = finalOwner.page.getByRole('button', { name: 'Resend code' });
  await expect(burn.or(resend)).toBeVisible();
  if (!(await burn.isVisible().catch(() => false))) {
    if ((await emails()).length === 0) {
      await resend.click();
    }
    await expect.poll(async () => (await emails()).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const codeMessage = (await emails()).find((message) =>
      message.subject?.includes('redemption authorization code'),
    );
    expect(codeMessage).toBeTruthy();
    const code = codeMessage!.text.match(/code is ([A-Z0-9-]+)/)?.[1];
    expect(code).toBeTruthy();

    await finalOwner.page.getByLabel('Owner authorization code').fill(code!);
    await finalOwner.page.getByRole('button', { name: 'Verify code and sign' }).click();
  }
  await expect(burn).toBeVisible();
  await burn.click();
  await tapThroughSteps(
    finalOwner.page,
    finalOwner.page.getByRole('button', { name: 'View receipt' }),
  );
  await expect.poll(() => nft.exists(tokenId), { timeout: 30_000 }).toBe(false);
  await finalOwner.page.reload();
  await expect(finalOwner.page.getByText(/chain burned/i).first()).toBeVisible();
  await finalOwner.context.close();
});
