import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		env: { FORCE_COLOR: '1' },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
		},
	},
});
