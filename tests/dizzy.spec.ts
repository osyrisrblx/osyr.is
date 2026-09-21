import { expect, test, type Page } from '@playwright/test';

async function openWithPreloadedFace(page: Page) {
  const faceLoaded = page.waitForResponse('**/biggerhead-texture-dizzy.svg');
  await page.goto('/');
  await (await faceLoaded).finished();
  await expect(page.locator('#head-stage')).toHaveAttribute(
    'data-state',
    'ready',
  );
  // A slow software renderer must not turn the simulated quick spin into a slow one.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

async function spinHead(page: Page) {
  await page.mouse.move(1100, 350);
  await page.mouse.down();
  // Return to the same pose so the screenshot isolates the face change.
  for (let turn = 0; turn < 4; turn++) {
    await page.mouse.move(1350, 350, { steps: 3 });
    await page.mouse.move(1100, 350, { steps: 3 });
  }
  await expect(page.locator('#head-stage')).toHaveAttribute(
    'data-expression',
    'dizzy',
  );
}

test('quick spins cause dizziness immediately and only recover after inactivity', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await openWithPreloadedFace(page);
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  await spinHead(page);
  await page.clock.fastForward(4000);
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.mouse.up();
  await page.clock.fastForward(2800);
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.clock.fastForward(250);
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.clock.runFor(800);
  await page.clock.fastForward(400);
  await expect(stage).toHaveAttribute('data-expression', 'shaking');
  await page.clock.runFor(200);
  await page.clock.fastForward(650);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await expect(stage).toHaveAttribute('data-state', 'ready');
});

test('reduced motion swaps the actual face and restores it without moving the head', async ({
  page,
}) => {
  await page.clock.install();
  await openWithPreloadedFace(page);
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  const canvas = page.locator('#head-canvas');
  const normal = await canvas.screenshot();
  await spinHead(page);
  await page.mouse.up();
  await page.clock.runFor(32);
  const dizzy = await canvas.screenshot();
  expect(dizzy.equals(normal)).toBe(false);
  await page.clock.fastForward(3000);
  await page.clock.fastForward(800);
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  expect((await canvas.screenshot()).equals(dizzy)).toBe(true);
  await page.clock.fastForward(450);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await page.clock.runFor(32);
  expect((await canvas.screenshot()).equals(normal)).toBe(true);
});

test('continued keyboard spins keep the dizzy face and delay recovery', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await openWithPreloadedFace(page);
  const stage = page.locator('#head-stage');
  await page.locator('#head-canvas').focus();
  for (let turn = 0; turn < 62; turn++) await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.clock.fastForward(2800);
  await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.clock.fastForward(2800);
  await expect(stage).toHaveAttribute('data-expression', 'dizzy');
  await page.clock.fastForward(200);
  await page.clock.runFor(1200);
  await expect(stage).toHaveAttribute('data-expression', 'shaking');
  await page.clock.runFor(800);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
});

test('an unavailable optional texture keeps normal interaction working', async ({
  page,
}) => {
  await page.route('**/biggerhead-texture-dizzy.svg', (route) => route.abort());
  await page.clock.install();
  await page.goto('/');
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  const canvas = page.locator('#head-canvas');
  await canvas.focus();
  const before = await canvas.screenshot();
  for (let turn = 0; turn < 80; turn++) await page.keyboard.press('ArrowRight');
  await page.clock.fastForward(3100);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});

test('slow turns do not accumulate into dizziness', async ({ page }) => {
  await page.clock.install();
  await openWithPreloadedFace(page);
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  await page.locator('#head-canvas').focus();
  await page.keyboard.press('ArrowRight');
  for (let burst = 0; burst < 4; burst++) {
    for (let turn = 0; turn < 20; turn++)
      await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-expression', 'normal');
    await page.clock.fastForward(4000);
  }
});

test('a new drag immediately cancels the dizzy recovery and keeps control', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await openWithPreloadedFace(page);
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  await spinHead(page);
  await page.mouse.up();
  await page.clock.fastForward(3000);
  await page.clock.runFor(1200);
  await expect(stage).toHaveAttribute('data-expression', 'shaking');
  await page.clock.runFor(200);
  await page.mouse.down();
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  const canvas = page.locator('#head-canvas');
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  const held = await canvas.screenshot();
  await page.mouse.move(1250, 350, { steps: 4 });
  await page.clock.runFor(300);
  expect((await canvas.screenshot()).equals(held)).toBe(false);
  await page.clock.fastForward(5000);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.up();
});
