/**
 * @fileoverview `taskgraph completion --install`: write the script and load it
 * from the shell's startup file. Safe to run again: the script is replaced and
 * the startup line is only added once.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Shell } from './scripts.js';

export interface InstallPaths {
	/** Where the completion script goes */
	script: string;
	/** Startup file that loads it; fish loads its completions folder itself */
	rc?: string;
}

export interface InstallResult extends InstallPaths {
	/** True when an earlier script was replaced */
	replaced: boolean;
	/** True when the load line was added this time, false when already there */
	rcUpdated: boolean;
}

export interface InstallEnv {
	home?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}

export function installPaths(
	shell: Shell,
	options: InstallEnv = {}
): InstallPaths {
	const home = options.home ?? os.homedir();
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	switch (shell) {
		case 'zsh':
			return {
				script: path.join(home, '.taskgraph-completion.zsh'),
				rc: path.join(env.ZDOTDIR || home, '.zshrc')
			};
		case 'bash': {
			// macOS Terminal starts login shells, which read .bash_profile
			const profile = path.join(home, '.bash_profile');
			const rc =
				platform === 'darwin' && fs.existsSync(profile)
					? profile
					: path.join(home, '.bashrc');
			return { script: path.join(home, '.taskgraph-completion.bash'), rc };
		}
		case 'fish':
			return {
				script: path.join(
					env.XDG_CONFIG_HOME || path.join(home, '.config'),
					'fish',
					'completions',
					'taskgraph.fish'
				)
			};
	}
}

/** Show a path the way people type it: ~/.zshrc rather than /Users/me/.zshrc */
export function displayPath(file: string, home = os.homedir()): string {
	return file === home || file.startsWith(home + path.sep)
		? `~${file.slice(home.length)}`
		: file;
}

export function installCompletion(
	shell: Shell,
	script: string,
	options: InstallEnv = {}
): InstallResult {
	const home = options.home ?? os.homedir();
	const paths = installPaths(shell, options);
	const replaced = fs.existsSync(paths.script);
	fs.mkdirSync(path.dirname(paths.script), { recursive: true });
	fs.writeFileSync(paths.script, script);
	if (!paths.rc) return { ...paths, replaced, rcUpdated: false };

	// $HOME rather than an absolute path, so synced dotfiles work elsewhere
	const target = paths.script.startsWith(home + path.sep)
		? `$HOME${paths.script.slice(home.length)}`
		: paths.script;
	const current = fs.existsSync(paths.rc)
		? fs.readFileSync(paths.rc, 'utf8')
		: '';
	if (current.includes(target) || current.includes(paths.script)) {
		return { ...paths, replaced, rcUpdated: false };
	}

	const separator = current === '' || current.endsWith('\n') ? '' : '\n';
	fs.appendFileSync(
		paths.rc,
		`${separator}\n# TaskGraph Tab completion\n[ -f "${target}" ] && source "${target}"\n`
	);
	return { ...paths, replaced, rcUpdated: true };
}
