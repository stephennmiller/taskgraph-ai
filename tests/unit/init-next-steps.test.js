import { getLocalGettingStartedMessage } from '../../scripts/modules/init-next-steps.js';

const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text) => text.replace(ANSI, '');

describe('getLocalGettingStartedMessage', () => {
	const message = plain(getLocalGettingStartedMessage());

	it('does not tell users to add AI provider API keys', () => {
		expect(message).not.toMatch(/api key/i);
		expect(message).not.toMatch(/\.env/);
	});

	it('says AI calls run through Claude Code', () => {
		expect(message).toContain('Claude Code');
	});

	it('points at the models command for choosing models', () => {
		expect(message).toContain('taskgraph models');
	});

	it('suggests a markdown PRD path', () => {
		expect(message).toContain('.taskgraph/docs/prd.md');
		expect(message).not.toContain('.taskgraph/docs/prd.txt');
	});

	it('keeps the shipped PRD template names', () => {
		expect(message).toContain('example_prd.txt');
		expect(message).toContain('example_prd_rpg.txt');
	});

	it('keeps the core workflow steps in order', () => {
		const order = [
			'parse-prd',
			'analyze-complexity',
			'expand --all',
			'taskgraph next'
		].map((step) => message.indexOf(step));

		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});
});
