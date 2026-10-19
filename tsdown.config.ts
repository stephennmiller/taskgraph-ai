import { readFileSync } from 'fs';
import { resolve } from 'path';
import { baseConfig, mergeConfig } from '@tm/build-config';
import { config } from 'dotenv';
import { defineConfig } from 'tsdown';

// Load .env file explicitly with absolute path
config({ path: resolve(process.cwd(), '.env') });

// Get all TM_PUBLIC_* env variables for build-time injection
const getBuildTimeEnvs = () => {
	const envs: Record<string, string> = {};

	// Inject package.json version at build time
	try {
		const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
		envs['TM_PUBLIC_VERSION'] = packageJson.version || 'unknown';
	} catch (error) {
		console.warn('Could not read package.json version during build:', error);
		envs['TM_PUBLIC_VERSION'] = 'unknown';
	}

	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith('TM_PUBLIC_')) {
			envs[key] = value || '';
		}
	}

	return envs;
};

export default defineConfig(
	mergeConfig(baseConfig, {
		entry: {
			taskgraph: 'scripts/dev.js',
			'mcp-server': 'mcp-server/server.js'
		},
		outDir: 'dist',
		// package.json "bin", postpack and the scripts reference dist/*.js. The
		// package is "type": "module", so .js is ESM. tsdown >= 0.16 defaults to .mjs.
		outExtensions: () => ({ js: '.js' }),
		copy: ['assets'],
		ignoreWatch: ['node_modules', 'dist', 'tests'],
		// Bundle only our workspace packages, keep npm dependencies external
		noExternal: [/^@tm\//],
		env: getBuildTimeEnvs()
	})
);
