import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const promptsDir = path.dirname(fileURLToPath(import.meta.url));

describe('Prompt Migration Validation', () => {
	const bannedPhrases = [
		'Respond ONLY with',
		'Return only the',
		'valid JSON',
		'Do not include any explanatory text',
		'Do not include any explanation',
		'code block markers'
	];

	// Map banned phrases to contexts where they're allowed
	const allowedContexts: Record<string, string[]> = {
		'respond only with': ['Use markdown formatting for better readability'],
		'return only the': ['Use markdown formatting for better readability']
	};

	test('prompts should not contain JSON formatting instructions', () => {
		const promptFiles = fs
			.readdirSync(promptsDir)
			.filter((file) => file.endsWith('.json') && !file.includes('schema'))
			// Exclude update-subtask.json as it returns plain strings, not JSON
			.filter((file) => file !== 'update-subtask.json');

		promptFiles.forEach((file) => {
			const content = fs.readFileSync(path.join(promptsDir, file), 'utf8');

			bannedPhrases.forEach((phrase) => {
				const lowerContent = content.toLowerCase();
				const lowerPhrase = phrase.toLowerCase();

				if (lowerContent.includes(lowerPhrase)) {
					// Check if this phrase is allowed in its context
					const allowedInContext = allowedContexts[lowerPhrase];
					const isAllowed =
						allowedInContext &&
						allowedInContext.some((context) =>
							lowerContent.includes(context.toLowerCase())
						);

					expect(
						isAllowed,
						`File ${file} contains banned phrase "${phrase}" without allowed context`
					).toBe(true);
				}
			});
		});
	});
});
