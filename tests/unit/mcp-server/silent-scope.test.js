import {
	disableSilentMode,
	enableSilentMode,
	isSilentMode,
	withSilentScope
} from '../../../scripts/modules/utils.js';
import { scopeToolExecution } from '../../../mcp-server/src/tools/silent-scope.js';

/** A promise the test resolves by hand, so ordering never depends on timers */
const gate = () => {
	let open;
	const promise = new Promise((resolve) => (open = resolve));
	return { promise, open };
};

describe('per-call silent mode', () => {
	afterEach(() => disableSilentMode());

	test('a fast call finishing does not un-silence a slow call', async () => {
		const hold = gate();
		const started = gate();
		const slow = withSilentScope(async () => {
			enableSilentMode();
			started.open();
			await hold.promise;
			return isSilentMode();
		});
		await started.promise;

		await withSilentScope(async () => {
			enableSilentMode();
			disableSilentMode();
		});
		hold.open();

		expect(await slow).toBe(true);
	});

	test('a scope does not change silent mode outside it', async () => {
		await withSilentScope(async () => {
			enableSilentMode();
		});

		expect(isSilentMode()).toBe(false);
	});

	test('outside any scope the global switch still works', () => {
		enableSilentMode();
		expect(isSilentMode()).toBe(true);
		disableSilentMode();
		expect(isSilentMode()).toBe(false);
	});

	test('a scope starts silent when the global switch is already on', () => {
		enableSilentMode();

		expect(withSilentScope(() => isSilentMode())).toBe(true);
	});

	test('a scope inside a silent scope stays silent', () => {
		const inner = withSilentScope(() => {
			enableSilentMode();
			return withSilentScope(() => isSilentMode());
		});

		expect(inner).toBe(true);
	});
});

describe('scopeToolExecution', () => {
	const serverWith = () => {
		const added = [];
		const server = {
			addTool: (tool) => added.push(tool),
			name: 'srv',
			ping() {
				return this.name;
			}
		};
		return { added, scoped: scopeToolExecution(server) };
	};

	test('gives each tool call its own scope', async () => {
		const { added, scoped } = serverWith();
		const hold = gate();
		const started = gate();
		scoped.addTool({
			name: 'slow',
			execute: async () => {
				enableSilentMode();
				started.open();
				await hold.promise;
				return isSilentMode();
			}
		});
		scoped.addTool({
			name: 'fast',
			execute: async () => {
				enableSilentMode();
				disableSilentMode();
				return 'fast';
			}
		});

		const slow = added[0].execute();
		await started.promise;
		expect(await added[1].execute()).toBe('fast');
		hold.open();

		expect(await slow).toBe(true);
	});

	test('passes arguments and results through, and keeps other server methods', async () => {
		const { added, scoped } = serverWith();
		scoped.addTool({ name: 't', execute: async (a, b) => `${a}-${b}` });

		expect(await added[0].execute('x', 'y')).toBe('x-y');
		expect(scoped.ping()).toBe('srv');
	});

	test('a tool that throws still rejects and leaves no silence behind', async () => {
		const { added, scoped } = serverWith();
		scoped.addTool({
			name: 'boom',
			execute: async () => {
				enableSilentMode();
				throw new Error('boom');
			}
		});

		await expect(added[0].execute()).rejects.toThrow('boom');
		expect(isSilentMode()).toBe(false);
	});
});
