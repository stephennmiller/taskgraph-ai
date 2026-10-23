import { describe, expect, it } from 'vitest';
import { FormatHandler } from './format-handler.js';

describe('FormatHandler.extractMetadata', () => {
	it("counts the older 'completed' status as done for a tag without metadata", () => {
		const data = {
			master: {
				tasks: [
					{ id: 1, status: 'completed' },
					{ id: 2, status: 'done' },
					{ id: 3, status: 'pending' }
				]
			}
		};

		const metadata = new FormatHandler().extractMetadata(data, 'master');

		expect(metadata?.taskCount).toBe(3);
		expect(metadata?.completedCount).toBe(2);
	});
});
