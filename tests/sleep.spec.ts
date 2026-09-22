import { expect, test, type Page } from '@playwright/test';

async function openHead(page: Page, reducedMotion = false) {
	await page.emulateMedia({
		reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
	});
	await page.clock.install();
	const loaded = ['blink', 'sleep'].map((face) =>
		page.waitForResponse(`**/biggerhead-texture-${face}.svg`),
	);
	await page.goto('/');
	for (const response of loaded) await (await response).finished();
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
	await page.mouse.move(100, 300);
}

test('a minute of inactivity closes the eyes, droops the head, and shows decorative Zs', async ({
	page,
}) => {
	await openHead(page);
	const stage = page.locator('#head-stage');
	const symbols = page.locator('#head-sleep span').first();
	await page.clock.fastForward(59000);
	await expect(stage).not.toHaveAttribute('data-expression', 'sleeping');
	await expect(symbols).toBeHidden();
	await page.clock.fastForward(1100);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await expect(symbols).toBeVisible();
	await expect(page.locator('#head-sleep')).toHaveAttribute(
		'aria-hidden',
		'true',
	);
	const canvas = page.locator('#head-canvas');
	await page.clock.runFor(16);
	const startingToSleep = await canvas.screenshot();
	await page.clock.runFor(1600);
	expect((await canvas.screenshot()).equals(startingToSleep)).toBe(false);
	await page.clock.fastForward(120000);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await page.mouse.move(101, 300);
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await expect(symbols).toBeHidden();
});

test('page activity restarts the sleep delay and keyboard input wakes without being consumed', async ({
	page,
}) => {
	await openHead(page);
	const stage = page.locator('#head-stage');
	await page.clock.fastForward(45000);
	await page.mouse.move(102, 300);
	await page.clock.fastForward(59000);
	await expect(stage).not.toHaveAttribute('data-expression', 'sleeping');
	await page.locator('#head-canvas').focus();
	await page.clock.fastForward(60100);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await page.keyboard.press('Enter');
	await expect(stage).toHaveAttribute('data-expression', 'blink');
	await expect(stage).toHaveAttribute('data-gesture', 'boop');
	await expect(page.locator('#head-sleep span').first()).toBeHidden();
});

test('a held drag never sleeps and the first drag after sleep keeps control', async ({
	page,
}) => {
	await openHead(page);
	const stage = page.locator('#head-stage');
	const canvas = page.locator('#head-canvas');
	await page.mouse.move(1100, 350);
	await page.mouse.down();
	await page.clock.fastForward(180000);
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	await page.mouse.up();
	// Let the separate three-second return-to-tracking timer complete first.
	await page.clock.fastForward(3100);
	await page.clock.fastForward(57000);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await page.clock.runFor(1000);
	await page.mouse.down();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	const before = await canvas.screenshot();
	await page.mouse.move(1220, 350, { steps: 4 });
	await page.clock.runFor(300);
	expect((await canvas.screenshot()).equals(before)).toBe(false);
	await page.mouse.up();
});

test('reduced motion suppresses sleep and enabling it wakes a sleeping head', async ({
	page,
}) => {
	await openHead(page, true);
	const stage = page.locator('#head-stage');
	const canvas = page.locator('#head-canvas');
	const initial = await canvas.screenshot();
	await page.clock.fastForward(180000);
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await expect(page.locator('#head-sleep span').first()).toBeHidden();
	expect((await canvas.screenshot()).equals(initial)).toBe(true);
	const changed = page.evaluate(
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
	await changed;
	await page.clock.fastForward(60100);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await expect(page.locator('#head-sleep span').first()).toBeHidden();
	await page.clock.fastForward(180000);
	await expect(stage).toHaveAttribute('data-expression', 'normal');
});

test('missing sleep texture or lost WebGL never leaves floating Zs', async ({
	page,
}) => {
	await page.route('**/biggerhead-texture-sleep.svg', (route) =>
		route.abort(),
	);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.clock.install();
	await page.goto('/');
	const stage = page.locator('#head-stage');
	await expect(stage).toHaveAttribute('data-state', 'ready');
	await page.clock.fastForward(120000);
	await expect(stage).not.toHaveAttribute('data-expression', 'sleeping');
	await expect(page.locator('#head-sleep span').first()).toBeHidden();
	await page.unroute('**/biggerhead-texture-sleep.svg');
	await openHead(page);
	await page.clock.fastForward(60100);
	await expect(stage).toHaveAttribute('data-expression', 'sleeping');
	await page.locator('#head-canvas').dispatchEvent('webglcontextlost');
	await expect(stage).toHaveAttribute('data-state', 'unavailable');
	await expect(page.locator('#head-sleep span').first()).toBeHidden();
});

test('a real mobile tap wakes the head and boops without blocking page interaction', async ({
	browser,
}) => {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});
	try {
		const page = await context.newPage();
		await openHead(page);
		await page.clock.fastForward(60100);
		const stage = page.locator('#head-stage');
		await expect(stage).toHaveAttribute('data-expression', 'sleeping');
		await page.clock.runFor(1600);
		await page.touchscreen.tap(280, 250);
		await expect(stage).toHaveAttribute('data-expression', 'blink');
		await expect(stage).toHaveAttribute('data-gesture', 'boop');
		await expect(page.locator('#head-sleep span').first()).toBeHidden();
		expect(await page.evaluate(() => scrollY)).toBe(0);
	} finally {
		await context.close();
	}
});
