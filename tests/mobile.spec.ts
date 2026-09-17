import { expect, test, type CDPSession } from '@playwright/test';

async function swipe(
  session: CDPSession,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY }],
  });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: fromX + ((toX - fromX) * step) / 8,
          y: fromY + ((toY - fromY) * step) / 8,
        },
      ],
    });
  }
}

test.describe('mobile gestures', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Native touch gestures use Chromium’s DevTools input API.',
  );
  test.use({
    viewport: { width: 390, height: 650 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#head-stage')).toHaveAttribute(
      'data-state',
      'ready',
    );
  });

  for (const [direction, x, y] of [
    ['horizontal', 100, 250],
    ['vertical', 280, 80],
    ['diagonal', 200, 80],
  ] as const) {
    test(`${direction} drags on the head rotate without scrolling`, async ({
      page,
      context,
    }) => {
      const canvas = page.locator('#head-canvas');
      const before = await canvas.screenshot();
      const session = await context.newCDPSession(page);
      await swipe(session, 280, 250, x, y);
      await expect(canvas).toHaveAttribute('data-interaction', 'drag');
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect(canvas).toHaveAttribute('data-interaction', 'none');
      await expect
        .poll(async () => (await canvas.screenshot()).equals(before))
        .toBe(false);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await expect(page.locator('#head-stage')).toHaveAttribute(
        'data-gesture',
        'none',
      );

      // A new swipe on the background must still scroll after a head drag.
      await swipe(session, 20, 525, 20, 300);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(30);
    });
  }

  test('a swipe starting off the head scrolls even when it crosses the head', async ({
    page,
    context,
  }) => {
    const session = await context.newCDPSession(page);
    const canvas = page.locator('#head-canvas');
    await swipe(session, 20, 525, 100, 300);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(30);
    await expect(canvas).not.toHaveAttribute('data-interaction', 'drag');
  });

  test('cancelling a drag releases the head without a boop and allows another drag', async ({
    page,
    context,
  }) => {
    const session = await context.newCDPSession(page);
    const canvas = page.locator('#head-canvas');
    await swipe(session, 280, 250, 280, 180);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await expect(canvas).toHaveAttribute('data-interaction', 'none');
    await expect(page.locator('#head-stage')).toHaveAttribute(
      'data-gesture',
      'none',
    );
    await swipe(session, 280, 250, 240, 300);
    await expect(canvas).toHaveAttribute('data-interaction', 'drag');
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  });

  test('two fingers can pinch to zoom over the head', async ({
    page,
    context,
  }) => {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: 240, y: 250 }],
    });
    await expect(page.locator('#head-canvas')).toHaveAttribute(
      'data-interaction',
      'drag',
    );
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: 240, y: 250 },
        { id: 2, x: 300, y: 250 },
      ],
    });
    await expect(page.locator('#head-canvas')).toHaveAttribute(
      'data-interaction',
      'none',
    );
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { id: 1, x: 240 - step * 10, y: 250 },
          { id: 2, x: 300 + step * 6, y: 250 },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => visualViewport!.scale))
      .toBeGreaterThan(1);
    await expect(page.locator('#head-stage')).toHaveAttribute(
      'data-gesture',
      'none',
    );
  });

  test('a second finger outside the canvas ends the drag until all fingers lift', async ({
    page,
    context,
  }) => {
    const session = await context.newCDPSession(page);
    const canvas = page.locator('#head-canvas');
    await swipe(session, 280, 250, 280, 200);
    await expect(canvas).toHaveAttribute('data-interaction', 'drag');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 0, x: 280, y: 200 },
        { id: 1, x: 20, y: 620 },
      ],
    });
    await expect(canvas).toHaveAttribute('data-interaction', 'none');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ id: 0, x: 280, y: 200 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 0, x: 240, y: 200 }],
    });
    await expect(canvas).toHaveAttribute('data-interaction', 'none');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(page.locator('#head-stage')).toHaveAttribute(
      'data-gesture',
      'none',
    );
  });
});
