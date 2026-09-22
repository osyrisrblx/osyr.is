import { expect, test } from '@playwright/test';

test('renders the model and responds to keyboard and drag', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	const canvas = page.locator('#head-canvas');
	const initial = await canvas.screenshot();

	await canvas.focus();
	await page.keyboard.press('ArrowRight');
	await expect
		.poll(async () => (await canvas.screenshot()).equals(initial))
		.toBe(false);
	const turned = await canvas.screenshot();
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		bounds.x + bounds.width / 2 + 130,
		bounds.y + bounds.height / 2,
		{ steps: 8 },
	);
	await page.mouse.up();
	await expect
		.poll(async () => (await canvas.screenshot()).equals(turned))
		.toBe(false);

	expect(errors).toEqual([]);
});

test('project and profile links expose their destinations directly', async ({
	page,
}) => {
	await page.goto('/');
	await expect(
		page.locator('#projects').getByRole('link', { name: /roblox-ts/ }),
	).toHaveAttribute('href', 'https://roblox-ts.com');
	await expect(
		page
			.locator('#projects')
			.getByRole('link', { name: /Runtime typechecking/ }),
	).toHaveAttribute('href', 'https://github.com/osyrisrblx/t');
	await expect(
		page.getByRole('link', { name: 'Sponsor on GitHub' }),
	).toHaveAttribute('href', 'https://github.com/sponsors/osyrisrblx');
	await expect(
		page.getByRole('navigation').getByRole('link', { name: 'GitHub' }),
	).toHaveAttribute('href', 'https://github.com/osyrisrblx');
	const externalLinks = page.locator('a[href^="https://"]');
	await expect(externalLinks).toHaveCount(6);
	for (const link of await externalLinks.all()) {
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	}
	await expect(
		page.getByRole('link', { name: 'Osyris home' }),
	).not.toHaveAttribute('target', '_blank');
});

test('reduced motion leaves the head still until an explicit interaction', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	const canvas = page.locator('#head-canvas');
	const initial = await canvas.screenshot();
	await page.mouse.move(1400, 100);
	await page.waitForTimeout(250);
	expect((await canvas.screenshot()).equals(initial)).toBe(true);
});

test('an asset failure keeps the content available', async ({ page }) => {
	await page.route('**/assets/biggerhead.obj', (route) => route.abort());
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	await expect(page.locator('#head-canvas')).toBeHidden();
	await expect(
		page.getByRole('link', { name: 'GitHub', exact: false }).first(),
	).toBeVisible();
	await expect(
		page.locator('#projects').getByRole('link', { name: /roblox-ts/ }),
	).toBeVisible();
});

test('WebGL loss hides the head without blocking the page', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	await page
		.locator('#head-canvas')
		.evaluate((canvas) =>
			canvas.dispatchEvent(
				new Event('webglcontextlost', { cancelable: true }),
			),
		);
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	await expect(page.locator('#head-canvas')).toBeHidden();
});

test('mobile layout fits the viewport and keeps projects usable', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	for (const width of [320, 390, 768]) {
		await page.setViewportSize({ width, height: 844 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.locator('#projects').scrollIntoViewIfNeeded();
	const bounds = (await page.locator('#projects').boundingBox())!;
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('content and profile links work without JavaScript', async ({
	browser,
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto(test.info().project.use.baseURL!);
	await expect(page.locator('#head-canvas')).toBeHidden();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(page.locator('#projects')).toBeInViewport();
	await expect(
		page
			.getByRole('navigation')
			.getByRole('link', { name: 'Roblox', exact: true }),
	).toHaveAttribute('href', 'https://www.roblox.com/users/83348/profile');
	await expect(
		page.getByRole('link', { name: 'Sponsor on GitHub' }),
	).toHaveAttribute('href', 'https://github.com/sponsors/osyrisrblx');
	await context.close();
});

test('the head returns to mouse tracking after inactivity, but never during a held drag', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.clock.install();
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	const canvas = page.locator('#head-canvas');
	await page.mouse.move(720, 550);
	await page.clock.runFor(1000);
	const initial = await canvas.screenshot();
	await page.mouse.down();
	await page.mouse.move(860, 550, { steps: 8 });
	await page.clock.runFor(750);
	// Skip idle frames while preserving the held-drag and inactivity deadlines.
	await page.clock.fastForward(3750);
	const held = await canvas.screenshot();
	await page.mouse.up();
	await page.clock.fastForward(2000);
	const waiting = await canvas.screenshot();
	await page.clock.fastForward(1500);
	await page.clock.runFor(1000);
	const returned = await canvas.screenshot();
	const difference = async (left: Buffer, right: Buffer) =>
		page.evaluate(
			async ([a, b]) => {
				const pixels = async (base64: string) => {
					const image = new Image();
					image.src = `data:image/png;base64,${base64}`;
					await image.decode();
					const canvas = document.createElement('canvas');
					canvas.width = image.width;
					canvas.height = image.height;
					const context = canvas.getContext('2d')!;
					context.drawImage(image, 0, 0);
					return context.getImageData(0, 0, image.width, image.height)
						.data;
				};
				const [first, second] = await Promise.all([
					pixels(a),
					pixels(b),
				]);
				let changed = 0;
				for (let i = 0; i < first.length; i += 4) {
					if (
						Math.abs(first[i] - second[i]) +
							Math.abs(first[i + 1] - second[i + 1]) +
							Math.abs(first[i + 2] - second[i + 2]) >
						60
					)
						changed++;
				}
				return changed / (first.length / 4);
			},
			[left.toString('base64'), right.toString('base64')],
		);
	expect(await difference(initial, held)).toBeGreaterThan(0.06);
	expect(await difference(initial, waiting)).toBeGreaterThan(0.06);
	expect(await difference(initial, returned)).toBeLessThan(0.04);
});

test('only the visible head offers a grab cursor and starts a drag', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	const canvas = page.locator('#head-canvas');
	const initial = await canvas.screenshot();
	await page.mouse.move(250, 300);
	await expect(canvas).toHaveCSS('cursor', 'default');
	await page.mouse.down();
	await page.mouse.move(380, 300, { steps: 5 });
	await page.mouse.up();
	expect((await canvas.screenshot()).equals(initial)).toBe(true);
	await page.mouse.move(1100, 350);
	await expect(canvas).toHaveCSS('cursor', 'grab');
	await page.mouse.down();
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	await page.mouse.move(250, 300, { steps: 5 });
	await expect(canvas).toHaveCSS('cursor', 'grabbing');
	await page.mouse.up();
	expect((await canvas.screenshot()).equals(initial)).toBe(false);
});
