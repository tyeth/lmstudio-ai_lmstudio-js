import { expect, test } from '@playwright/test';

test('connects to external lms server and fetches models', async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', exception => console.log(`PAGE ERROR: "${exception}"`));

  await page.goto('/');

  // Find the WebSocket base URL input and fill it
  const wsInput = page.getByLabel('WebSocket base URL');
  await wsInput.fill('ws://192.168.1.207:1234');

  // Click the Connect button
  const connectButton = page.getByRole('button', { name: /^Connect$|^Reconnect$/i });
  await connectButton.click();

  // Wait for the connection status to be connected
  const status = page.locator('.status').first();
  try {
    await expect(status).toHaveText(/connected/i, { timeout: 15000 });
  } catch (e) {
    const errorText = await page.locator('.callout.error').textContent();
    console.error('Connection Error Output:', errorText);
    throw e;
  }
  
  // Wait for models to populate (ensure downloaded or loaded models section shows up)
  // Just checking that we don't get a connection error for now
  await expect(page.locator('.callout.error')).not.toBeVisible();
});
