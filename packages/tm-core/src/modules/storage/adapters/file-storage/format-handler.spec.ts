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

describe('FormatHandler tasks and metadata keys (#802)', () => {
	const handler = new FormatHandler();

	it('reads an untagged file as untagged', () => {
		const data = { tasks: [{ id: '1' }], metadata: { tags: ['master'] } };

		expect(handler.detectFormat(data)).toBe('standard');
		expect(handler.extractTags(data)).toEqual(['master']);
	});

	it('reads a tasks or metadata key holding a tag as a tag', () => {
		const data = { metadata: { tasks: [{ id: '1' }], metadata: {} } };

		expect(handler.detectFormat(data)).toBe('legacy');
		expect(handler.extractTags(data)).toEqual(['metadata']);
		expect(handler.extractTasks(data, 'master')).toEqual([{ id: '1' }]);
	});
});
