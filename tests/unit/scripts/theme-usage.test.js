/**
 * Legacy terminal output must use the TaskGraph theme, not fixed ANSI colors.
 * chalk.white is pale gray on many light themes and chalk.blue is hard to read
 * on dark ones, so text goes through theme.text / theme.brand and boxen borders
 * through BORDER_COLOR (all exported from @tm/cli).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCAN_DIRS = ['scripts', 'src/ui', 'src/utils'];

// chalk.white, chalk.bold.white, chalk.blue.underline, ...
const FIXED_TEXT_COLOR = /chalk(\.\w+)*\.(white|blue)\b/;
const FIXED_BORDER_COLOR = /borderColor:\s*['"]blue['"]/;

function listJsFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listJsFiles(full);
		return entry.name.endsWith('.js') ? [full] : [];
	});
}

function findOffenders(pattern) {
	return SCAN_DIRS.flatMap((dir) => listJsFiles(path.join(ROOT, dir)))
		.flatMap((file) =>
			fs
				.readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ file, line, number: index + 1 }))
		)
		.filter(({ line }) => pattern.test(line))
		.map(({ file, number }) => `${path.relative(ROOT, file)}:${number}`);
}

// chalk.gray is bright black, nearly invisible on Solarized Dark and similar themes
const BRIGHT_BLACK = /chalk\.gr[ae]y\b/;
const GRAY_SCAN_DIRS = [
	'scripts',
	'src',
	'mcp-server/src',
	...packageSrcDirs()
];

function packageSrcDirs() {
	return fs
		.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `packages/${entry.name}/src`)
		.filter((dir) => fs.existsSync(path.join(ROOT, dir)));
}

function listSourceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return ['node_modules', 'dist'].includes(entry.name)
				? []
				: listSourceFiles(full);
		}
		const isSource = /\.(js|ts)$/.test(entry.name);
		const isTest = /\.(spec|test)\./.test(entry.name);
		return isSource && !isTest ? [full] : [];
	});
}

function findGrayOffenders() {
	return (
		GRAY_SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(ROOT, dir)))
			.flatMap((file) =>
				fs
					.readFileSync(file, 'utf8')
					.split('\n')
					.map((line, index) => ({
						file,
						line: line.trim(),
						number: index + 1
					}))
			)
			// Comments may mention chalk.gray to explain why it is avoided
			.filter(
				({ line }) => !/^(\*|\/\/|\/\*)/.test(line) && BRIGHT_BLACK.test(line)
			)
			.map(({ file, number }) => `${path.relative(ROOT, file)}:${number}`)
	);
}

describe('legacy terminal colors', () => {
	it('uses theme.text / theme.brand instead of chalk.white / chalk.blue', () => {
		expect(findOffenders(FIXED_TEXT_COLOR)).toEqual([]);
	});

	it('uses theme.muted or chalk.dim instead of chalk.gray', () => {
		expect(findGrayOffenders()).toEqual([]);
	});

	it("uses BORDER_COLOR instead of borderColor: 'blue'", () => {
		expect(findOffenders(FIXED_BORDER_COLOR)).toEqual([]);
	});
});
