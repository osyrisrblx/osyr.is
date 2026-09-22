import { expect, test, type Page } from '@playwright/test';

async function openWithFaces(page: Page) {
	const loaded = ['blink', 'heart', 'wink'].map((face) =>
		page.waitForResponse(`**/biggerhead-texture-${face}.svg`),
	);
	await page.clock.install();
	await page.goto('/');
	for (const response of loaded) await (await response).finished();
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

test('a tap boops, springs back, and a new drag cancels the reaction', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openWithFaces(page);
	const stage = page.locator('#head-stage');
	const canvas = page.locator('#head-canvas');
	await page.mouse.click(1100, 350);
	await expect(stage).toHaveAttribute('data-expression', 'blink');
	await expect(stage).toHaveAttribute('data-gesture', 'boop');
	await page.clock.runFor(100);
	const squished = await canvas.screenshot();
	await page.clock.runFor(550);
	await expect(stage).toHaveAttribute('data-gesture', 'none');
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	expect((await canvas.screenshot()).equals(squished)).toBe(false);

	await page.keyboard.press('Enter');
	await expect(stage).toHaveAttribute('data-gesture', 'boop');
	await page.mouse.down();
	await expect(stage).toHaveAttribute('data-gesture', 'none');
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.mouse.move(1220, 350, { steps: 3 });
	await page.mouse.up();
	await expect(stage).toHaveAttribute('data-gesture', 'none');
	await expect(canvas).toHaveCSS('cursor', 'grab');
});

test('long presses, cancelled pointers, and drags back to their origin do not boop', async ({
	page,
}) => {
	await openWithFaces(page);
	const stage = page.locator('#head-stage');
	await page.mouse.move(1100, 350);
	await page.mouse.down();
	await page.clock.fastForward(500);
	await page.mouse.up();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.mouse.down();
	await page.mouse.move(1150, 350);
	await page.mouse.move(1100, 350);
	await page.mouse.up();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.locator('#head-canvas').evaluate((canvas) => {
		canvas.addEventListener(
			'pointerdown',
			(event) => {
				canvas.dispatchEvent(
					new PointerEvent('pointercancel', {
						pointerId: (event as PointerEvent).pointerId,
					}),
				);
			},
			{ once: true },
		);
	});
	await page.mouse.down();
	await page.mouse.up();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
});

test('support hover and keyboard focus show heart eyes without moving under reduced motion', async ({
	page,
}) => {
	await openWithFaces(page);
	const stage = page.locator('#head-stage');
	const canvas = page.locator('#head-canvas');
	const initial = await canvas.screenshot();
	const support = page.getByRole('link', { name: 'Sponsor on GitHub' });
	await support.hover();
	await expect(stage).toHaveAttribute('data-expression', 'hearts');
	await page.clock.runFor(32);
	const hearts = await canvas.screenshot();
	expect(hearts.equals(initial)).toBe(false);
	await page.clock.fastForward(20000);
	expect((await canvas.screenshot()).equals(hearts)).toBe(true);
	await page.mouse.move(100, 300);
	await page.clock.runFor(32);
	expect((await canvas.screenshot()).equals(initial)).toBe(true);
	await support.focus();
	await expect(stage).toHaveAttribute('data-expression', 'hearts');
	await canvas.focus();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.keyboard.press('Space');
	await expect(stage).toHaveAttribute('data-expression', 'blink');
	await expect(stage).not.toHaveAttribute('data-gesture', 'boop');
	await page.clock.fastForward(160);
	await page.clock.runFor(32);
	expect((await canvas.screenshot()).equals(initial)).toBe(true);
});

test('support keyboard focus shows heart eyes, and dragging takes priority', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openWithFaces(page);
	const canvas = page.locator('#head-canvas');
	await page.getByRole('link', { name: 'Sponsor on GitHub' }).focus();
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-expression',
		'hearts',
	);
	await page.mouse.move(1100, 350);
	await page.mouse.down();
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-expression',
		'normal',
	);
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	await page.mouse.move(1250, 350);
	await page.mouse.up();
});

test('an occasional idle wink restores the face and yields to interaction', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openWithFaces(page);
	const stage = page.locator('#head-stage');
	for (let i = 0; i < 4; i++) {
		await page.clock.fastForward(10000);
		await expect(stage).toHaveAttribute('data-expression', 'blink');
		await page.clock.fastForward(160);
	}
	await page.clock.fastForward(10000);
	await expect(stage).toHaveAttribute('data-expression', 'wink');
	await page.clock.runFor(32);
	const wink = await page.locator('#head-canvas').screenshot();
	await page.mouse.move(1100, 350);
	await page.mouse.down();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.clock.runFor(32);
	expect((await page.locator('#head-canvas').screenshot()).equals(wink)).toBe(
		false,
	);
	await page.clock.fastForward(60000);
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	await page.mouse.up();
});

test('vertical overdrag rebounds on release before tracking resumes', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openWithFaces(page);
	const canvas = page.locator('#head-canvas');
	await page.mouse.move(1100, 350);
	await page.mouse.down();
	await page.mouse.move(1100, 850, { steps: 4 });
	await page.clock.runFor(700);
	const held = await canvas.screenshot();
	await page.mouse.up();
	await page.clock.runFor(800);
	const released = await canvas.screenshot();
	expect(released.equals(held)).toBe(false);
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-expression',
		'normal',
	);
	// Grabbing the springing head remains possible immediately.
	await page.mouse.move(1100, 500);
	await page.mouse.down();
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	await page.mouse.up();
});

test('missing new expressions leave the head and links usable', async ({
	page,
}) => {
	await page.route('**/biggerhead-texture-{heart,wink}.svg', (route) =>
		route.abort(),
	);
	await page.goto('/');
	const stage = page.locator('#head-stage');
	await expect(stage).toHaveAttribute('data-state', 'ready');
	await page.getByRole('link', { name: 'Sponsor on GitHub' }).hover();
	await expect(stage).toHaveAttribute('data-expression', 'normal');
	const canvas = page.locator('#head-canvas');
	await canvas.focus();
	const initial = await canvas.screenshot();
	await page.keyboard.press('ArrowRight');
	await expect
		.poll(async () => (await canvas.screenshot()).equals(initial))
		.toBe(false);
});

test('mobile taps boop without a sticky hover or page scroll', async ({
	browser,
}) => {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		reducedMotion: 'no-preference',
	});
	try {
		const page = await context.newPage();
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await openWithFaces(page);
		await page.touchscreen.tap(280, 250);
		await expect(page.locator('#head-stage')).toHaveAttribute(
			'data-expression',
			'blink',
		);
		await page.clock.runFor(650);
		await expect(page.locator('#head-stage')).toHaveAttribute(
			'data-expression',
			'normal',
		);
		await expect(page.locator('#head-canvas')).toHaveCSS(
			'cursor',
			'default',
		);
		expect(await page.evaluate(() => scrollY)).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});
