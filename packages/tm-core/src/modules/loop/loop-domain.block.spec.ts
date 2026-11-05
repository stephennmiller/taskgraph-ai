/**
 * @fileoverview LoopDomain's blockTask: the note is written before the
 * blocked status, so a failed write never leaves a stuck task blocked with no reason (#997)
 */

import { expect, it, vi } from 'vitest';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TasksDomain } from '../tasks/tasks-domain.js';
import { LoopDomain } from './loop-domain.js';
import type { LoopServiceOptions } from './services/loop-service-options.js';

const captured = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock('./services/loop.service.js', () => ({
	LoopService: vi.fn(function (this: { run: unknown }, options: unknown) {
		captured.options = options;
		this.run = vi.fn().mockResolvedValue({});
	})
}));

it('leaves the task unblocked when its note fails to save', async () => {
	const tasks = {
		addNote: vi.fn().mockRejectedValue(new Error('locked')),
		updateStatus: vi.fn()
	};
	const domain = new LoopDomain(
		{
			getProjectRoot: () => '/p',
			getConfig: () => ({})
		} as unknown as ConfigManager,
		tasks as unknown as TasksDomain
	);
	await domain.run({ trusted: true });
	const { blockTask } = captured.options as LoopServiceOptions;

	await expect(blockTask?.('1', 'stuck', 'main')).rejects.toThrow('locked');

	expect(tasks.updateStatus).not.toHaveBeenCalled();
});
