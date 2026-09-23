import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('project deep links, browser history, and the skip link use native navigation', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 650 });
	await page.goto('/#projects');
	await expect(page.locator('#projects')).toBeInViewport();
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(
		page.getByRole('link', { name: 'Skip to projects' }),
	).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/#projects$/);
	await expect(page.locator('#projects')).toBeInViewport();
	await expect(page.locator('#projects')).toBeFocused();
	await page.goBack();
	await expect(page).not.toHaveURL(/#projects$/);
	await page.goForward();
	await expect(page.locator('#projects')).toBeInViewport();
});

test('navigation works when the 3D module cannot download', async ({
	page,
}) => {
	await page.route(/\/_astro\/playground\.[^/]+\.js$/, (route) =>
		route.abort(),
	);
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	await expect(page.locator('#head-canvas')).toBeHidden();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(page.locator('#projects')).toBeInViewport();
});

test('a stalled texture times out and its late arrival does not revive the renderer', async ({
	page,
}) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/biggerhead-texture-normal.svg', async (route) => {
		await pending;
		await route.continue();
	});
	await page.clock.install();
	const requested = page.waitForRequest('**/biggerhead-texture-normal.svg');
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await requested;
	await expect(page.locator('#head-stage img')).toHaveCount(0);
	await expect(page.locator('#head-canvas')).toBeHidden();
	await page.clock.fastForward(16_000);
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	const response = page.waitForResponse('**/biggerhead-texture-normal.svg');
	release();
	await (await response).finished();
	await page.clock.runFor(100);
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	await expect(page.locator('#head-canvas')).toBeHidden();
});

test('WebGL unavailability leaves the page usable before asset loading', async ({
	page,
}) => {
	await page.addInitScript(`
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args);
    };
  `);
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'unavailable',
	);
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(page.locator('#projects')).toBeInViewport();
});

test('the page passes automated accessibility checks at desktop and mobile sizes', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		const result = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(
			result.violations,
			`${width}px accessibility violations`,
		).toEqual([]);
	}
});

test('the renderer pauses offscreen and resumes when visible', async ({
	page,
}) => {
	await page.addInitScript(`
    window.__drawCalls = 0;
    for (const method of ['drawArrays', 'drawElements']) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function(...args) {
        window.__drawCalls++;
        return original.apply(this, args);
      };
    }
  `);
	const drawCalls = () =>
		page.evaluate(
			() => (window as unknown as { __drawCalls: number }).__drawCalls,
		);
	await page.setViewportSize({ width: 390, height: 200 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/');
	await page.locator('#head-canvas').scrollIntoViewIfNeeded();
	await expect.poll(drawCalls).toBeGreaterThan(0);
	await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
	await expect(page.locator('#head-canvas')).not.toBeInViewport();
	await page.waitForTimeout(100);
	const paused = await drawCalls();
	await page.waitForTimeout(250);
	expect(await drawCalls()).toBe(paused);
	await page.locator('#head-canvas').scrollIntoViewIfNeeded();
	await expect.poll(drawCalls).toBeGreaterThan(paused);
});

test('social metadata and the custom not-found page have working destinations', async ({
	page,
	request,
}) => {
	await page.goto('/');
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		'href',
		'https://osyr.is/',
	);
	const card = await request.get('/social-card.png');
	expect(card.ok()).toBe(true);
	expect(card.headers()['content-type']).toContain('image/png');
	await page.goto('/404.html');
	await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
	await page.getByRole('link', { name: 'Back home' }).click();
	await expect(
		page.getByRole('heading', { name: 'OSYRIS', exact: true }),
	).toBeVisible();
});

test('the head fills the right edge and top corner across viewport sizes', async ({
	page,
}) => {
	for (const viewport of [
		{ width: 2304, height: 1320 },
		{ width: 3200, height: 1080 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		// Flatten the decorative glow and grain so gaps show a known color.
		await page.addStyleTag({
			content:
				'.poster-hero { background: #080808 !important; } .poster-hero::after { display: none; }',
		});
		await expect(page.locator('#head-stage')).toHaveAttribute(
			'data-state',
			'ready',
		);
		const canvas = page.locator('#head-canvas');
		for (const key of ['Home', 'ArrowUp', 'ArrowRight']) {
			await canvas.focus();
			if (key !== 'Home') await page.keyboard.press(key);
			const screenshot = await canvas.screenshot();
			const gaps = await page.evaluate(async (base64) => {
				const image = new Image();
				image.src = `data:image/png;base64,${base64}`;
				await image.decode();
				const sample = document.createElement('canvas');
				sample.width = image.width;
				sample.height = image.height;
				const context = sample.getContext('2d')!;
				context.drawImage(image, 0, 0);
				// The transparent canvas shows the flattened #080808 background through gaps.
				return Array.from({ length: 21 }, (_, index) => {
					const y = Math.round(2 + ((image.height - 5) * index) / 20);
					const [r, g, b] = context.getImageData(
						image.width - 3,
						y,
						1,
						1,
					).data;
					return (
						Math.abs(r - 8) <= 1 &&
						Math.abs(g - 8) <= 1 &&
						Math.abs(b - 8) <= 1
					);
				}).filter(Boolean).length;
			}, screenshot.toString('base64'));
			expect(
				gaps,
				`${viewport.width}px, ${key}: uncovered right edge`,
			).toBe(0);
		}
		await expect(page.locator('.site-header nav')).toHaveCSS(
			'background-color',
			'rgba(0, 0, 0, 0)',
		);
	}
});

test('desktop fits the poster and bottom strip without scrolling', async ({
	page,
}) => {
	for (const viewport of [
		{ width: 1024, height: 500 },
		{ width: 1024, height: 600 },
		{ width: 1366, height: 768 },
		{ width: 1440, height: 900 },
		{ width: 1920, height: 1080 },
		{ width: 3440, height: 1440 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page.locator('#head-stage')).toHaveAttribute(
			'data-state',
			'ready',
		);
		expect(
			await page.evaluate(() => ({
				width: document.documentElement.scrollWidth,
				height: document.documentElement.scrollHeight,
			})),
		).toEqual(viewport);
		const strip = (await page.locator('#projects').boundingBox())!;
		expect(strip.y + strip.height).toBeLessThanOrEqual(viewport.height);
		const intro = (await page.locator('.intro').boundingBox())!;
		const title = (await page.locator('h1').boundingBox())!;
		expect(title.y).toBeGreaterThan(intro.y + intro.height);
		await page.mouse.wheel(0, 500);
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
	}
});
