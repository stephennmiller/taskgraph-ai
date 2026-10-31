/**
 * @fileoverview Task assignees: GitHub logins, stored lowercase so a task,
 * a filter and an issue's assignees compare with plain equality
 */

import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';

/** GitHub logins: letters, digits, hyphens; Enterprise Managed Users add `_shortcode` */
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/;

/**
 * The login to store for `value`, or null to clear the assignee (an empty
 * value). A leading `@` is dropped. Throws INVALID_INPUT for anything that
 * can't be a GitHub login.
 */
export function normalizeAssignee(value: string): string | null {
	const login = value.trim().replace(/^@/, '').toLowerCase();
	if (!login) return null;
	if (!LOGIN_PATTERN.test(login)) {
		throw errorWithHint(
			ERROR_CODES.INVALID_INPUT,
			`"${value}" isn't a GitHub login`,
			'Pass a GitHub username such as `octocat`, or an empty value to clear it'
		);
	}
	return login;
}

/**
 * `item`'s assignee as sync and filters compare it: lowercase, since a
 * hand-edited file may hold `Alice`; undefined when it isn't a string
 */
export function assigneeOf(item: { assignee?: unknown }): string | undefined {
	return typeof item.assignee === 'string'
		? item.assignee.toLowerCase() || undefined
		: undefined;
}
