/**
 * TaskGraph sends nothing to an error-reporting service: the Sentry telemetry
 * (which also recorded AI inputs and outputs) is removed. The per-command AI
 * usage and cost summary (telemetryData) is local and stays.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCAN_DIRS = ['scripts', 'src', 'mcp-server', 'apps', 'packages'];

function listSourceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return ['node_modules', 'dist', 'coverage', '.turbo'].includes(entry.name)
				? []
				: listSourceFiles(full);
		}
		return /\.(js|ts|mjs)$/.test(entry.name) ? [full] : [];
	});
}

describe('Sentry telemetry', () => {
	test('the sentry module is gone', () => {
		expect(fs.existsSync(path.join(ROOT, 'src/telemetry/sentry.js'))).toBe(
			false
		);
	});

	test('@sentry/node is not a dependency', () => {
		const manifest = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
		expect(manifest).not.toMatch(/sentry/i);
	});

	test('no source file mentions Sentry or the telemetry opt-out', () => {
		const offenders = SCAN_DIRS.flatMap((dir) =>
			listSourceFiles(path.join(ROOT, dir))
		).filter((file) =>
			/sentry|anonymousTelemetry|getAITelemetryConfig|hashProjectRoot/i.test(
				fs.readFileSync(file, 'utf8')
			)
		);

		expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
	});
});
