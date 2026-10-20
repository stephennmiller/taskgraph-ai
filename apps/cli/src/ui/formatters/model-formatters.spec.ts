import { describe, expect, it } from 'vitest';
import {
	formatModelChanges,
	formatModelChoices,
	formatModelConfiguration
} from './model-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatModelConfiguration', () => {
	it('lists each role with its model and what it is for', () => {
		const output = plain(
			formatModelConfiguration(
				{ main: 'sonnet', research: 'opus', fallback: 'haiku' },
				['opus', 'sonnet', 'haiku']
			)
		);

		expect(output.split('\n')).toEqual([
			'Models',
			'  Main      sonnet  creates and updates tasks',
			'  Research  opus    research and --research runs',
			'  Fallback  haiku   used if the main model fails',
			'',
			'Choices: opus (most capable), sonnet (balanced), haiku (fastest)',
			'Change them with taskgraph models --setup'
		]);
	});

	it('shows none for a role without a model', () => {
		const output = plain(
			formatModelConfiguration(
				{ main: 'sonnet', research: 'sonnet', fallback: null },
				['sonnet']
			)
		);

		expect(output).toContain(
			'  Fallback  none    used if the main model fails'
		);
	});

	it('leaves out the choices line when none are known', () => {
		const output = plain(
			formatModelConfiguration(
				{ main: 'sonnet', research: 'sonnet', fallback: 'sonnet' },
				[]
			)
		);

		expect(output).not.toContain('Choices');
	});
});

describe('formatModelChoices', () => {
	it('names models without a note as they are', () => {
		expect(formatModelChoices(['opus', 'custom'])).toBe(
			'opus (most capable), custom'
		);
	});
});

describe('formatModelChanges', () => {
	it('shows one change on one line', () => {
		const output = plain(
			formatModelChanges([{ role: 'main', from: 'sonnet', to: 'opus' }])
		);

		expect(output).toBe('✓ Main model  sonnet → opus');
	});

	it('marks a model that was already set', () => {
		const output = plain(
			formatModelChanges([{ role: 'research', from: 'opus', to: 'opus' }])
		);

		expect(output).toBe('✓ Research model  opus (unchanged)');
	});

	it('counts only real changes when several roles were set', () => {
		const output = plain(
			formatModelChanges([
				{ role: 'main', from: 'sonnet', to: 'opus' },
				{ role: 'research', from: 'sonnet', to: 'sonnet' },
				{ role: 'fallback', from: null, to: 'haiku' }
			])
		);

		expect(output.split('\n')).toEqual([
			'✓ Updated 2 models',
			'  Main      sonnet → opus',
			'  Research  sonnet (unchanged)',
			'  Fallback  haiku'
		]);
	});

	it('says so when none of several roles changed', () => {
		const output = plain(
			formatModelChanges([
				{ role: 'main', from: 'opus', to: 'opus' },
				{ role: 'fallback', from: 'haiku', to: 'haiku' }
			])
		);

		expect(output.split('\n')[0]).toBe('✓ Models unchanged');
	});
});
