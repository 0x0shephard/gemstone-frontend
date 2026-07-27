import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public marketplace has no critical accessibility violations', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: /marketplace/i })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
});

test('landing page keeps the complete ownership path in chain mode', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Lifecycle of the NFT' })).toBeVisible();
  for (const heading of [
    'KYC, Gemological Review and Custody',
    'Minting NFTs',
    'Trading NFTs',
    'Redemption Process',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
});

test('app navigation stays hidden until opened and closes after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/marketplace');

  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  const drawer = page.getByRole('dialog', { name: 'Main navigation' });

  await expect(openNavigation).toBeVisible();
  await expect(drawer).toBeHidden();

  await openNavigation.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Marketplace' })).toBeVisible();

  await drawer.getByRole('link', { name: 'Auctions' }).click();
  await expect(page).toHaveURL('/auctions');
  await expect(drawer).toBeHidden();
});

test('mobile navigation keeps primary destinations and secondary routes reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/marketplace');

  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  const dock = page.getByRole('navigation', { name: 'Primary mobile navigation' });
  await expect(dock.getByRole('link', { name: 'Market' })).toBeVisible();
  await expect(dock.getByRole('link', { name: 'Auctions' })).toBeVisible();
  await expect(dock.getByRole('link', { name: 'Swap' })).toBeVisible();
  await expect(dock.getByRole('link', { name: 'Vault' })).toBeVisible();

  await dock.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('dialog', { name: 'More destinations' });
  await expect(menu.getByRole('link', { name: /redeem/i })).toBeVisible();
  await expect(menu.getByRole('link', { name: /seller portal/i })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
});

test('color scheme switch persists the alternate midnight palette', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'atelier');

  await page.getByRole('button', { name: 'Switch to Midnight navy color scheme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'garnet');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'garnet');
  await expect(page.getByRole('button', { name: 'Switch to Ivory color scheme' })).toBeVisible();
});

test('account pages provide a direct route back to the landing page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page).toHaveURL('/');
});

test('disabled Google auth is explained instead of failing silently', async ({ page }) => {
  await page.route('**/auth/v1/settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ external: { google: false } }),
    });
  });

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await expect(
    page.getByText(/Google sign-in is disabled in this Supabase project/i),
  ).toBeVisible();
});
