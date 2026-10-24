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

const shared = mergeConfig(baseConfig, {
	outDir: 'dist',
	// package.json "bin", postpack and the scripts reference dist/*.js. The
	// package is "type": "module", so .js is ESM. tsdown >= 0.16 defaults to .mjs.
	outExtensions: () => ({ js: '.js' }),
	ignoreWatch: ['node_modules', 'dist', 'tests'],
	env: getBuildTimeEnvs()
});

// The CLI and the MCP server are built separately so they share no chunks.
// The CLI imports most of its code on demand (#248), and from one build
// rolldown placed modules both need in dist/mcp-server.js, so running a CLI
// command started the MCP server.
export default defineConfig([
	{
		...shared,
		entry: { taskgraph: 'scripts/dev.js' },
		copy: ['assets'],
		// @tm/core in one chunk. Left to itself, rolldown may put a core module
		// in the chunk of whichever lazy import uses it, such as the AI
		// provider's, and loading core then loads the AI SDK too.
		outputOptions: {
			codeSplitting: {
				groups: [{ name: 'tm-core', test: /[\\/]packages[\\/]tm-core[\\/]/ }]
			}
		}
	},
	{ ...shared, entry: { 'mcp-server': 'apps/mcp/src/main.ts' } }
]);
