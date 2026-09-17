import { expect, test } from '@playwright/test';

test('idle blinks briefly close the eyes, but dragging keeps them open', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  const loaded = page.waitForResponse('**/biggerhead-texture-blink.webp');
  await page.goto('/');
  await (await loaded).finished();
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.clock.fastForward(10000);
  await expect(stage).toHaveAttribute('data-expression', 'blink');
  await page.clock.runFor(16);
  const canvas = page.locator('#head-canvas');
  const closed = await canvas.screenshot();
  await page.clock.fastForward(160);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  expect((await canvas.screenshot()).equals(closed)).toBe(false);
  await page.mouse.move(1100, 350);
  await page.mouse.down();
  await page.clock.fastForward(15000);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await page.mouse.up();
});

test('reduced motion suppresses blinking and cancels a blink immediately', async ({
  page,
}) => {
  await page.clock.install();
  const loaded = page.waitForResponse('**/biggerhead-texture-blink.webp');
  await page.goto('/');
  await (await loaded).finished();
  const stage = page.locator('#head-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready');
  await page.clock.fastForward(20000);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  const motionChanged = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
          'change',
          () => resolve(),
          { once: true },
        );
      }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await motionChanged;
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.clock.fastForward(10000);
  await expect(stage).toHaveAttribute('data-expression', 'blink');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(stage).toHaveAttribute('data-expression', 'normal');
  await page.clock.fastForward(20000);
  await expect(stage).toHaveAttribute('data-expression', 'normal');
});
