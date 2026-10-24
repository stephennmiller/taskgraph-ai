/**
 * NO_COLOR convention (https://no-color.org)
 */
import { describe, expect, it } from 'vitest';
import { applyNoColor } from './no-color.js';

describe('applyNoColor', () => {
	it('disables color when NO_COLOR is set', () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
		const colors = { level: 3 };
		applyNoColor(env, colors);
		expect(env.FORCE_COLOR).toBe('0');
		expect(colors.level).toBe(0);
	});

	it('leaves color alone when NO_COLOR is unset', () => {
		const env: NodeJS.ProcessEnv = {};
		const colors = { level: 3 };
		applyNoColor(env, colors);
		expect(env.FORCE_COLOR).toBeUndefined();
		expect(colors.level).toBe(3);
	});

	it('ignores an empty NO_COLOR, as the convention specifies', () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: '' };
		applyNoColor(env, { level: 3 });
		expect(env.FORCE_COLOR).toBeUndefined();
	});

	it('lets an explicit FORCE_COLOR win over NO_COLOR', () => {
		const env: NodeJS.ProcessEnv = { NO_COLOR: '1', FORCE_COLOR: '3' };
		const colors = { level: 3 };
		applyNoColor(env, colors);
		expect(env.FORCE_COLOR).toBe('3');
		expect(colors.level).toBe(3);
	});
});
