/**
 * Preload (`node --import`) that makes the CLI believe stdout is a terminal,
 * so integration tests can check what a user sees in a real terminal while
 * still capturing stdout through a pipe. Only stdout is forced: stdin stays a
 * pipe, so nothing prompts.
 */
Object.defineProperty(process.stdout, 'isTTY', {
	value: true,
	configurable: true
});
