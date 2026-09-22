import { defineConfig } from '@playwright/test';
import process from 'node:process';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4323';

export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL,
		viewport: { width: 1440, height: 1100 },
		reducedMotion: 'reduce',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				browserName: 'chromium',
				launchOptions: { args: ['--enable-unsafe-swiftshader'] },
			},
		},
		{
			name: 'firefox',
			use: {
				browserName: 'firefox',
				launchOptions: {
					firefoxUserPrefs: {
						'webgl.force-enabled': true,
						'gfx.webrender.software': true,
					},
				},
			},
		},
	],
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command:
					'astro preview --host 127.0.0.1 --port 4323 --ignore-lock',
				url: baseURL,
				reuseExistingServer: !process.env.CI,
				env: { ASTRO_TELEMETRY_DISABLED: '1' },
			},
});
