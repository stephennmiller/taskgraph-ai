/**
 * `npm run test -w <package>` is how CLAUDE.md and the contributor docs say
 * to run one package's tests. It must pass when every test passes, so plain
 * `vitest run` leaves coverage off; `npm run test:coverage` turns it on and
 * enforces the thresholds (issue #259).
 */

import cliConfig from '../../../apps/cli/vitest.config';
import mcpConfig from '../../../apps/mcp/vitest.config';
import coreConfig from '../../../packages/tm-core/vitest.config';
import sharedConfig from '../../../vitest.config';

const configs = [
	['shared vitest.config.ts', sharedConfig],
	['@tm/core', coreConfig],
	['@tm/cli', cliConfig],
	['@tm/mcp', mcpConfig]
] as const;

describe('package Vitest coverage config', () => {
	it.each(configs)(
		'%s leaves coverage off for a plain run',
		(_name, config) => {
			expect(config.test?.coverage?.enabled).toBe(false);
		}
	);

	it.each(configs)('%s keeps thresholds for test:coverage', (_name, config) => {
		const coverage = config.test?.coverage;
		const thresholds =
			coverage && 'thresholds' in coverage ? coverage.thresholds : undefined;
		expect(thresholds).toMatchObject({
			lines: expect.any(Number),
			branches: expect.any(Number),
			functions: expect.any(Number),
			statements: expect.any(Number)
		});
	});

	it('keeps @tm/core at its higher 80% line threshold', () => {
		const coverage = coreConfig.test?.coverage;
		const thresholds =
			coverage && 'thresholds' in coverage ? coverage.thresholds : undefined;
		expect(thresholds).toMatchObject({ lines: 80 });
	});
});
