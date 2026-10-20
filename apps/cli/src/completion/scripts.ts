/**
 * @fileoverview Shell completion scripts for bash, zsh and fish.
 * Each script is a thin wrapper: it passes the words on the command line to
 * the embedded engine (see engine.ts) and hands the candidates to the shell.
 */

import { buildEngineProgram } from './engine.js';
import type { CommandSpec } from './spec.js';

export const SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

export function isShell(value: string): value is Shell {
	return (SHELLS as readonly string[]).includes(value);
}

/** Pick the shell from $SHELL, e.g. "/bin/zsh" → "zsh" */
export function detectShell(shellPath = process.env.SHELL): Shell | undefined {
	const name = (shellPath || '').split('/').pop() || '';
	return isShell(name) ? name : undefined;
}

/** Install by hand, for people who keep their own dotfiles */
export function installSteps(shell: Shell): string[] {
	switch (shell) {
		case 'bash':
			return [
				'taskgraph completion bash > ~/.taskgraph-completion.bash',
				"echo 'source ~/.taskgraph-completion.bash' >> ~/.bashrc"
			];
		case 'zsh':
			return [
				'taskgraph completion zsh > ~/.taskgraph-completion.zsh',
				"echo 'source ~/.taskgraph-completion.zsh' >> ~/.zshrc"
			];
		case 'fish':
			return [
				'mkdir -p ~/.config/fish/completions',
				'taskgraph completion fish > ~/.config/fish/completions/taskgraph.fish'
			];
	}
}

function header(shell: Shell, version: string): string {
	return [
		`# TaskGraph completion for ${shell} (taskgraph ${version})`,
		'# Install or update with: taskgraph completion --install',
		'# Run that again after upgrading TaskGraph.'
	].join('\n');
}

function bash(program: string): string {
	return `__taskgraph_program='${program}'

_taskgraph() {
	local cur="\${COMP_WORDS[COMP_CWORD]}" line i
	local -a out=()
	while IFS= read -r line; do
		out+=("$line")
	done < <(node -e "$__taskgraph_program" -- bash "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
	COMPREPLY=()
	[[ \${#out[@]} -ge 4 ]] || return 0
	local mode="\${out[0]#@}" listp="\${out[2]#@}"
	[[ "$cur" == "=" ]] && cur=""
	case "$mode" in
		files)
			compopt -o filenames 2>/dev/null
			while IFS= read -r line; do COMPREPLY+=("$line"); done < <(compgen -f -- "$cur")
			;;
		dirs)
			compopt -o filenames 2>/dev/null
			while IFS= read -r line; do COMPREPLY+=("$line"); done < <(compgen -d -- "$cur")
			;;
		*)
			compopt -o nosort 2>/dev/null
			for ((i = 4; i < \${#out[@]}; i++)); do
				COMPREPLY+=("$listp\${out[i]%%$'\\t'*}")
			done
			;;
	esac
}

complete -F _taskgraph taskgraph
if alias tm >/dev/null 2>&1; then
	complete -F _taskgraph tm
fi
`;
}

function zsh(program: string): string {
	return `__taskgraph_program='${program}'

_taskgraph() {
	local -a out items
	local mode optp listp label line
	out=("\${(@f)$(node -e "$__taskgraph_program" -- zsh "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
	(( \${#out} >= 4 )) || return 1
	mode=\${out[1]#@} optp=\${out[2]#@} listp=\${out[3]#@} label=\${out[4]#@}
	if [[ -n "$optp$listp" ]]; then
		IPREFIX="$IPREFIX$optp$listp"
		PREFIX="\${PREFIX#"$optp$listp"}"
	fi
	case $mode in
		files) _files ;;
		dirs) _files -/ ;;
		*)
			for line in "\${(@)out[5,-1]}"; do
				[[ -n "$line" ]] || continue
				if [[ "$line" == *$'\\t'* ]]; then
					items+=("\${\${line%%$'\\t'*}//:/\\\\:}:\${line#*$'\\t'}")
				else
					items+=("\${line//:/\\\\:}")
				fi
			done
			(( \${#items} )) || return 1
			_describe -V -t "\${label// /-}" "$label" items
			;;
	esac
}

if [[ "\${zsh_eval_context[-1]}" == loadautofunc ]]; then
	_taskgraph "$@"
else
	(( $+functions[compdef] )) || { autoload -Uz compinit && compinit }
	compdef _taskgraph taskgraph
fi
`;
}

function fish(program: string): string {
	return `set -g __taskgraph_program '${program}'

function __taskgraph_complete
	set -l tokens (commandline -opc)
	set -e tokens[1]
	set -l cur (commandline -ct)
	set -l out (node -e $__taskgraph_program -- fish $tokens "$cur" 2>/dev/null)
	test (count $out) -ge 4; or return
	set -l mode (string sub -s 2 -- $out[1])
	set -l optp (string sub -s 2 -- $out[2])
	set -l listp (string sub -s 2 -- $out[3])
	set -l value (string sub -s (math (string length -- "$optp") + 1) -- "$cur")
	switch $mode
		case files
			for p in (__fish_complete_path "$value")
				echo "$optp$p"
			end
		case dirs
			for p in (__fish_complete_directories "$value")
				echo "$optp$p"
			end
		case '*'
			test (count $out) -ge 5; or return
			for line in $out[5..-1]
				echo "$optp$listp$line"
			end
	end
end

complete -c taskgraph -f -k -a '(__taskgraph_complete)'
`;
}

/** Generate the completion script for one shell */
export function renderCompletionScript(
	shell: Shell,
	spec: CommandSpec,
	version = 'unknown'
): string {
	const program = buildEngineProgram(spec);
	if (program.includes("'") || program.includes('\\\\')) {
		throw new Error('Completion program cannot be quoted for the shell');
	}
	const body = { bash, zsh, fish }[shell](program);
	const first = shell === 'zsh' ? '#compdef taskgraph\n' : '';
	return `${first}${header(shell, version)}\n\n${body}`;
}
