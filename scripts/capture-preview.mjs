import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4322');
  await page.locator('#head-stage[data-state="ready"]').waitFor();
  await page.screenshot({ path: 'public/social-card.png' });
  console.log('Saved public/social-card.png (1200 × 630).');
} finally {
  await browser.close();
}
