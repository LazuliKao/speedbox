import { test, expect } from '@playwright/test';

const BACKEND_URL = 'http://localhost:8080';
const FRONTEND_URL = 'http://localhost:5173';

test.describe('Speedbox E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}?api=${BACKEND_URL}`);
  });

  test('page loads correctly', async ({ page }) => {
    await expect(page).toHaveTitle('Speedbox');
    await expect(page.locator('h1')).toContainText('Speedbox');
    await expect(page.locator('text=Backend:')).toBeVisible();
  });

  test('HTTP protocol speed test', async ({ page }) => {
    await page.click('text=HTTP');
    await page.click('text=▶ Start Speed Test');
    await expect(page.locator('text=Downloading...')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Test Complete')).toBeVisible({ timeout: 15000 });
    const downloadSpeed = page.locator('.gauge-label >> nth=0');
    await expect(downloadSpeed).not.toContainText('0.0');
  });

  test('WebSocket protocol speed test', async ({ page }) => {
    await page.click('[role="tab"]:has-text("WebSocket")');
    await page.click('text=▶ Start Speed Test');
    await expect(page.locator('text=Test Complete')).toBeVisible({ timeout: 15000 });
    const downloadSpeed = page.locator('.gauge-label >> nth=0');
    await expect(downloadSpeed).not.toContainText('0.0');
  });

  test('Advanced Settings panel', async ({ page }) => {
    await page.click('text=⚙ Advanced Settings');
    await expect(page.locator('text=Test Duration')).toBeVisible();
    await expect(page.locator('text=Chunk Size')).toBeVisible();
    await page.click('text=Advanced Settings');
  });

  test('Backend address edit', async ({ page }) => {
    await page.click('text=Edit');
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(BACKEND_URL);
  });

  test('protocol switching', async ({ page }) => {
    await expect(page.locator('[role="tab"]:has-text("HTTP")')).toHaveAttribute('aria-selected', 'true');
    await page.click('[role="tab"]:has-text("WebSocket")');
    await expect(page.locator('[role="tab"]:has-text("WebSocket")')).toHaveAttribute('aria-selected', 'true');
    await page.click('[role="tab"]:has-text("WebRTC")');
    await expect(page.locator('[role="tab"]:has-text("WebRTC")')).toHaveAttribute('aria-selected', 'true');
  });
});