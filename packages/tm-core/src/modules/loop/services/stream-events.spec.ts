import { describe, expect, it, vi } from 'vitest';
import { handleStreamEvent } from './stream-events.js';

const reply = (text: string) => ({
	type: 'assistant',
	message: { content: [{ type: 'text', text }] }
});

describe('handleStreamEvent', () => {
	it('leaves the stop marker off the text it shows', () => {
		const onText = vi.fn();

		handleStreamEvent(
			reply('Task 4 is done.\n\n<loop-complete>ALL_DONE</loop-complete>'),
			{ onText }
		);
		handleStreamEvent(reply('<loop-blocked>no credentials</loop-blocked>'), {
			onText
		});

		expect(onText.mock.calls).toEqual([['Task 4 is done.']]);
	});

	it('shows a marker quoted mid-reply, which does not stop the loop', () => {
		const onText = vi.fn();
		const text = 'I would end with <loop-complete>X</loop-complete> later.';

		handleStreamEvent(reply(text), { onText });

		expect(onText).toHaveBeenCalledWith(text);
	});
});
