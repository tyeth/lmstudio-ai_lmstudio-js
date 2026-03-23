import { expect, test } from '@playwright/test';

test('has title and connects', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/LM Studio Web/i);
  
  // App has initial disconnected state
  const status = page.locator('.status').first();
  await expect(status).toHaveText(/disconnected/i);
});
