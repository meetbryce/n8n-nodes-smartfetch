import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.test.ts'],
		exclude: ['node_modules/**'],
		coverage: {
			provider: 'v8',
			include: ['nodes/**/*.ts'],
			exclude: ['**/*.test.ts'],
		},
	},
});
