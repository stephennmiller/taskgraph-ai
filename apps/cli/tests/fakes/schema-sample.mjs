/**
 * Build a value that satisfies a JSON Schema, for the fake `claude` program.
 *
 * The schema the CLI passes to Claude Code (`--json-schema`) does not carry
 * every rule the app checks afterwards (a minimum length on `details`, for
 * one), so strings are long by default and the result is a shape check, not
 * a model of real output. A few field names the app gives meaning to are
 * handled by name: `dependencies` stays empty, a free-text `status` is
 * `pending`, and an `id` counts up through its array.
 */

const MIN_STRING_LENGTH = 60;

/**
 * @param {unknown} schema JSON Schema (draft-07 subset)
 * @param {string} [key] Property name, used to label generated strings
 * @param {number} [index] Position in the enclosing array, used for ids
 * @returns {unknown} A matching value, or null when the schema cannot be read
 */
export function sampleFromSchema(schema, key = 'value', index = 0) {
	if (!schema || typeof schema !== 'object' || '$ref' in schema) return null;
	if ('const' in schema) return schema.const;
	if (Array.isArray(schema.enum)) return schema.enum[0];

	const branches = schema.anyOf ?? schema.oneOf;
	if (Array.isArray(branches)) {
		const branch = branches.find((b) => b?.type !== 'null');
		return branch ? sampleFromSchema(branch, key, index) : null;
	}

	const type = Array.isArray(schema.type)
		? schema.type.find((t) => t !== 'null')
		: schema.type;

	if (type === 'object' || schema.properties) {
		return Object.fromEntries(
			Object.entries(schema.properties ?? {}).map(([name, sub]) => [
				name,
				sampleFromSchema(sub, name, index)
			])
		);
	}
	if (type === 'array') {
		if (key === 'dependencies' && !schema.minItems) return [];
		const count = Math.max(schema.minItems ?? 1, 1);
		return Array.from({ length: count }, (_, i) =>
			sampleFromSchema(schema.items, key, i)
		);
	}
	if (type === 'integer' || type === 'number') {
		if (key === 'id') return Math.max(index + 1, schema.minimum ?? 1);
		return schema.minimum ?? 1;
	}
	if (type === 'boolean') return true;
	if (type === 'string') {
		if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z';
		if (key === 'status') return 'pending';
		const length = Math.max(schema.minLength ?? 0, MIN_STRING_LENGTH);
		const text = `Sample ${key} `.padEnd(length, 'x');
		return schema.maxLength ? text.slice(0, schema.maxLength) : text;
	}
	return null;
}
