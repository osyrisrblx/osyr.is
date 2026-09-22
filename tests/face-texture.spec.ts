import { expect, test, type Page } from '@playwright/test';

type Raster = {
	face: string;
	size: number;
	canvas: number;
	border: number[];
	edgePixels: number;
};
type InstrumentedWindow = Window & { faceRasters: Raster[] };

async function observeRasters(page: Page, maxTextureSize?: number) {
	await page.addInitScript((limit) => {
		const records: Raster[] = [];
		(window as unknown as InstrumentedWindow).faceRasters = records;
		const canvases = new Set<HTMLCanvasElement>();
		const drawImage = CanvasRenderingContext2D.prototype.drawImage;
		CanvasRenderingContext2D.prototype.drawImage = function (
			...args: any[]
		) {
			(drawImage as Function).apply(this, args);
			const source = args[0];
			if (
				!(source instanceof HTMLImageElement) ||
				!source.src.includes('biggerhead-texture-')
			)
				return;
			canvases.add(this.canvas);
			const size = this.canvas.width;
			// Sample across the normal face's left eye. An SVG rendered at target
			// resolution has only a few antialiased pixels, even on a Retina display.
			const row = this.getImageData(
				Math.floor(((750 - 680) / 320) * size),
				Math.floor(((754 - 530) / 320) * size),
				Math.floor((68 / 320) * size),
				1,
			).data;
			let edgePixels = 0;
			for (let i = 0; i < row.length; i += 4) {
				if (row[i] > 10 && row[i] < 245) edgePixels++;
			}
			records.push({
				face: source.src.split('biggerhead-texture-')[1],
				size,
				canvas: [...canvases].indexOf(this.canvas),
				border: [...this.getImageData(0, 0, 1, 1).data],
				edgePixels,
			});
		};
		if (limit) {
			const getParameter = WebGL2RenderingContext.prototype.getParameter;
			WebGL2RenderingContext.prototype.getParameter = function (
				parameter,
			) {
				return parameter === this.MAX_TEXTURE_SIZE
					? limit
					: getParameter.call(this, parameter);
			};
		}
	}, maxTextureSize);
}

const rasters = (page: Page) =>
	page.evaluate(() => (window as unknown as InstrumentedWindow).faceRasters);

test('SVG faces stay crisp at Retina resolution and reuse one canvas across expressions and resizing', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await observeRasters(page);
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('biggerhead-texture-'))
			requests.push(request.url());
	});
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.size)
		.toBe(1024);
	await expect.poll(() => requests.length).toBe(6);
	expect(requests.every((url) => url.endsWith('.svg'))).toBe(true);

	await page.setViewportSize({ width: 2560, height: 1440 });
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.size)
		.toBe(2048);
	// Simulate a move to a Retina monitor with the same CSS viewport.
	await page.evaluate(() => {
		Object.defineProperty(window, 'devicePixelRatio', {
			value: 2,
			configurable: true,
		});
		window.dispatchEvent(new Event('resize'));
	});
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.size)
		.toBe(4096);
	const normal = (await rasters(page)).at(-1)!;
	expect(normal.face).toBe('normal.svg');
	expect(normal.edgePixels).toBeLessThanOrEqual(4);

	await page.getByRole('link', { name: 'Sponsor on GitHub' }).focus();
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-expression',
		'hearts',
	);
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.face)
		.toBe('heart.svg');
	await page.setViewportSize({ width: 1440, height: 800 });
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.size)
		.toBe(2048);
	expect((await rasters(page)).at(-1)?.face).toBe('heart.svg');
	await page.locator('#head-canvas').focus();
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.face)
		.toBe('normal.svg');
	const records = await rasters(page);
	expect(new Set(records.map((record) => record.canvas)).size).toBe(1);
	expect(
		records.every((record) => record.border.join() === '255,0,0,255'),
	).toBe(true);
	expect(requests).toHaveLength(6);
});

test('SVG rasterization respects the GPU texture size limit', async ({
	page,
}) => {
	await observeRasters(page, 1024);
	await page.setViewportSize({ width: 2560, height: 1440 });
	await page.goto('/');
	await expect(page.locator('#head-stage')).toHaveAttribute(
		'data-state',
		'ready',
	);
	await expect
		.poll(async () => (await rasters(page)).at(-1)?.size)
		.toBe(1024);
	expect((await rasters(page)).every((record) => record.size <= 1024)).toBe(
		true,
	);
});
