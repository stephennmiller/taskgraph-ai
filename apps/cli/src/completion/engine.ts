/**
 * @fileoverview The completion engine that runs on every Tab press.
 *
 * Starting the full CLI takes seconds, too slow for Tab. So the generated
 * shell script embeds this small program and runs it with `node -e`, which
 * starts in tens of milliseconds. It walks the command spec, and for task IDs
 * and tags it reads the project's tasks.json directly.
 *
 * Constraints, because the program is pasted inside single quotes in bash, zsh
 * and fish scripts: no single quotes, no double backslashes, no backticks.
 *
 * Usage: node -e "<program>" -- <bash|zsh|fish> <word>... <current word>
 *
 * Output: four header lines, each prefixed with "@" so none is ever empty:
 *   1. mode: values | files | dirs
 *   2. text before the value in the current word ("--id=" or "")
 *   3. list prefix for comma-separated values ("3,4," or "")
 *   4. group label for zsh ("commands", "options", "task IDs", ...)
 * then one candidate per line: value, optionally a tab and a description.
 * Candidates never include the prefixes; each shell adds what it needs.
 * Candidates come in display order (commands A-Z; IDs, statuses and flags
 * in their natural order), so the shells are told not to re-sort them.
 */

import type { CommandSpec } from './spec.js';

export const ENGINE_SOURCE = `
var fs = require("fs");
var path = require("path");
var args = process.argv.slice(1);
var shell = args.shift();
var words = shell === "bash" ? joinEquals(args) : args;
if (!words.length) words = [""];

function joinEquals(ws) {
	var out = [];
	for (var i = 0; i < ws.length; i++) {
		var last = out[out.length - 1];
		if (ws[i] === "=" && last && last.charAt(0) === "-" && last.indexOf("=") < 0) {
			out[out.length - 1] = last + "=" + (i + 1 < ws.length ? ws[++i] : "");
		} else {
			out.push(ws[i]);
		}
	}
	return out;
}

function findOption(cmd, flag) {
	for (var i = 0; i < cmd.options.length; i++) {
		var o = cmd.options[i];
		if (o.long === flag || o.short === flag) return o;
	}
	return null;
}

function findCommand(cmd, name) {
	for (var i = 0; i < cmd.commands.length; i++) {
		var c = cmd.commands[i];
		if (c.name === name || c.aliases.indexOf(name) >= 0) return c;
	}
	return null;
}

function emit(mode, optPrefix, listPrefix, label, items) {
	var lines = ["@" + mode, "@" + optPrefix, "@" + listPrefix, "@" + label];
	for (var i = 0; i < items.length; i++) {
		lines.push(items[i][1] ? items[i][0] + "\\t" + items[i][1] : items[i][0]);
	}
	process.stdout.write(lines.join("\\n") + "\\n");
	process.exit(0);
}

function startsWith(s, p) {
	return s.slice(0, p.length) === p;
}

function findProject(start) {
	var dir = path.resolve(start);
	for (;;) {
		var file = path.join(dir, ".taskgraph", "tasks", "tasks.json");
		if (fs.existsSync(file)) return { dir: dir, file: file };
		var up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

function readProject() {
	var project = findProject(projectDir || process.cwd());
	if (!project) return null;
	var data;
	try {
		data = JSON.parse(fs.readFileSync(project.file, "utf8"));
	} catch (e) {
		return null;
	}
	if (Array.isArray(data.tasks)) return { tags: [], tasks: data.tasks };
	var tags = Object.keys(data).filter(function (k) {
		return data[k] && Array.isArray(data[k].tasks);
	});
	var tag = tagOverride || process.env.TASKGRAPH_TAG;
	if (!tag) {
		try {
			var state = JSON.parse(
				fs.readFileSync(path.join(project.dir, ".taskgraph", "state.json"), "utf8")
			);
			tag = state.currentTag || state.activeTag;
		} catch (e) {}
	}
	if (tags.indexOf(tag) < 0) tag = tags.indexOf("master") >= 0 ? "master" : tags[0];
	return { tags: tags, tasks: tag ? data[tag].tasks : [] };
}

function taskIds(tasks) {
	var out = [];
	(function walk(list, parent) {
		for (var i = 0; i < (list || []).length; i++) {
			var t = list[i];
			var raw = String(t.id);
			var id = parent && raw.indexOf(".") < 0 ? parent + "." + raw : raw;
			var title = String(t.title || "").split(/\\s+/).join(" ").trim();
			out.push([id, t.status ? title + " (" + t.status + ")" : title]);
			walk(t.subtasks, id);
		}
	})(tasks, "");
	return out;
}

function completeValue(value, text, optPrefix) {
	if (value.kind === "files" || value.kind === "dirs") {
		emit(value.kind, optPrefix, "", value.kind, []);
	}
	var comma = value.kind === "ids" ? text.lastIndexOf(",") : -1;
	var listPrefix = comma < 0 ? "" : text.slice(0, comma + 1);
	var partial = text.slice(comma + 1);
	var taken = listPrefix.split(",");
	var items = [];
	var label = "values";
	if (value.kind === "choices") {
		items = value.choices.map(function (c) { return [c, ""]; });
	} else if (value.kind === "ids" || value.kind === "tags") {
		var project = readProject();
		if (project && value.kind === "ids") {
			items = taskIds(project.tasks);
			label = "task IDs";
		} else if (project) {
			items = project.tags.map(function (t) { return [t, ""]; });
			label = "tags";
		}
	}
	items = items.filter(function (it) {
		return startsWith(it[0], partial) && taken.indexOf(it[0]) < 0;
	});
	emit("values", optPrefix, listPrefix, label, items);
}

function completeOptions(cmd, cur, used) {
	var items = [];
	for (var i = 0; i < cmd.options.length; i++) {
		var o = cmd.options[i];
		if ((used[o.long] || used[o.short]) && !o.variadic) continue;
		if (o.long && startsWith(o.long, cur)) items.push([o.long, o.description]);
		else if (o.short && startsWith(o.short, cur) && cur.slice(0, 2) !== "--") {
			items.push([o.short, o.description]);
		}
	}
	emit("values", "", "", "options", items);
}

var cmd = SPEC;
var positional = 0;
var used = {};
var expecting = null;
var projectDir = null;
var tagOverride = null;
var cur = words[words.length - 1];
var before = words.slice(0, -1);

for (var i = 0; i < before.length; i++) {
	var w = before[i];
	if (w.length > 1 && w.charAt(0) === "-") {
		var eq = w.indexOf("=");
		var flag = eq < 0 ? w : w.slice(0, eq);
		var opt = findOption(cmd, flag);
		used[flag] = true;
		if (!opt || !opt.value) continue;
		var val = eq < 0 ? before[i + 1] : w.slice(eq + 1);
		if (eq < 0 && opt.optional && val !== undefined && val.charAt(0) === "-") continue;
		if (eq < 0 && i + 1 >= before.length) expecting = opt;
		else if (eq < 0) i++;
		if (opt.long === "--project") projectDir = val;
		if (opt.long === "--tag") tagOverride = val;
		continue;
	}
	var sub = positional === 0 ? findCommand(cmd, w) : null;
	if (sub) {
		cmd = sub;
		used = {};
	} else {
		positional++;
	}
}

if (expecting) completeValue(expecting.value, cur, "");

if (cur.charAt(0) === "-") {
	var eqAt = cur.indexOf("=");
	if (eqAt > 0) {
		var o = findOption(cmd, cur.slice(0, eqAt));
		if (o && o.value) completeValue(o.value, cur.slice(eqAt + 1), cur.slice(0, eqAt + 1));
		emit("values", "", "", "values", []);
	}
	completeOptions(cmd, cur, used);
}

if (positional === 0 && cmd.commands.length) {
	emit(
		"values", "", "", "commands",
		cmd.commands
			.filter(function (c) { return startsWith(c.name, cur); })
			.map(function (c) { return [c.name, c.description]; })
			.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })
	);
}

var arg = cmd.args[positional];
if (!arg && cmd.args.length && cmd.args[cmd.args.length - 1].variadic) {
	arg = cmd.args[cmd.args.length - 1];
}
if (arg && arg.value.kind !== "none") completeValue(arg.value, cur, "");
if (!arg && cur === "") completeOptions(cmd, cur, used);
emit("values", "", "", "values", []);
`;

/** Make JSON safe to paste inside single quotes in any of the three shells */
function shellSafeJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/'/g, '\\u0027')
		.replace(/\\\\/g, '\\u005c')
		.replace(/`/g, '\\u0060');
}

/** The full program for one spec: spec data plus the engine */
export function buildEngineProgram(spec: CommandSpec): string {
	return `var SPEC = ${shellSafeJson(spec)};\n${ENGINE_SOURCE}`;
}
