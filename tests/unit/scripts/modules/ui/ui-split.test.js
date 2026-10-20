import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	estimateTokens,
	MAX_TOKENS
} from '../../../../../.githooks/check-file-size.mjs';
import * as ui from '../../../../../scripts/modules/ui.js';

const modulesDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../../scripts/modules'
);

// The public names ui.js exports: what it exported before the split into
// ui/*.js, minus the functions #165 removed
const EXPECTED_EXPORTS = [
	'BORDER_COLOR',
	'confirmTaskOverwrite',
	'createProgressBar',
	'displayAddedSubtasks',
	'displayAiUsageSummary',
	'displayAsciiBanner',
	'displayBanner',
	'displayComplexityReport',
	'displayContextAnalysis',
	'displayCrossTagDependencyError',
	'displayCurrentTagIndicator',
	'displayDependencyValidationHints',
	'displayHelp',
	'displayInvalidTagCombinationError',
	'displaySubtaskMoveError',
	'displayTaggedTasksFYI',
	'failLoadingIndicator',
	'formatDependenciesWithStatus',
	'formatTaskIdForDisplay',
	'getComplexityWithColor',
	'getStatusWithColor',
	'infoLoadingIndicator',
	'startLoadingIndicator',
	'startParsePrdProgress',
	'stopLoadingIndicator',
	'succeedLoadingIndicator',
	'theme',
	'warnLoadingIndicator'
];

describe('scripts/modules/ui split', () => {
	it('exports exactly the same names as before the split', () => {
		expect(Object.keys(ui).sort()).toEqual([...EXPECTED_EXPORTS].sort());
	});

	it('keeps displayBanner as an alias of displayAsciiBanner', () => {
		expect(ui.displayBanner).toBe(ui.displayAsciiBanner);
	});

	it('keeps ui.js and every file under ui/ within the pre-commit size limit', () => {
		const uiDir = path.join(modulesDir, 'ui');
		const files = [
			path.join(modulesDir, 'ui.js'),
			...(fs.existsSync(uiDir)
				? fs
						.readdirSync(uiDir)
						.filter((f) => f.endsWith('.js'))
						.map((f) => path.join(uiDir, f))
				: [])
		];
		const oversized = files
			.map((f) => ({ f, tokens: estimateTokens(fs.statSync(f).size) }))
			.filter(({ tokens }) => tokens > MAX_TOKENS);
		expect(oversized).toEqual([]);
	});
});
