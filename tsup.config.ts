import { defineConfig } from 'tsup';
import tsconfigPaths from 'tsconfig-paths';

export default defineConfig({
	entry: ['src/index.ts'], // Adjust according to your entry file
	outDir: 'dist',
	sourcemap: true,
	clean: true,
});
