/**
 * AI call for `parse-prd --clarify`: the questions to ask about gaps in the
 * PRD before tasks are generated. Writing the answers into the PRD is
 * `writeClarifications` in @tm/core.
 */

import fs from 'fs';
import {
	MAX_CLARIFYING_QUESTIONS,
	normalizeClarifyingQuestions,
	COMMAND_SCHEMAS,
	getPromptManager
} from '@tm/core';
import { generateObjectService } from '../../ai-services-unified.js';

/**
 * Ask the model which gaps in the PRD would change the tasks
 *
 * @param {Object} options
 * @param {string} options.prdPath - Path to the PRD
 * @param {string} [options.projectRoot]
 * @param {boolean} [options.research] - Use the research role
 * @param {Object} [options.session] - MCP session
 * @param {boolean} [options.isMCP]
 * @returns {Promise<{questions: Array<{question: string, suggestedAnswer: string}>, telemetryData: Object|null}>}
 *   At most five questions, none the PRD's Clarifications section already answers
 */
export async function findPrdGaps({
	prdPath,
	projectRoot,
	research = false,
	session,
	isMCP = false
}) {
	const prdContent = fs.readFileSync(prdPath, 'utf8');
	const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
		'parse-prd-clarify',
		{ prdContent, maxQuestions: MAX_CLARIFYING_QUESTIONS }
	);

	const response = await generateObjectService({
		role: research ? 'research' : 'main',
		session,
		projectRoot,
		schema: COMMAND_SCHEMAS['parse-prd-clarify'],
		objectName: 'clarifying_questions',
		systemPrompt,
		prompt: userPrompt,
		commandName: 'parse-prd',
		outputType: isMCP ? 'mcp' : 'cli'
	});

	// generateObject results arrive as either { questions } or { object: { questions } }
	const result = response?.mainResult;
	const raw = Array.isArray(result?.questions)
		? result.questions
		: Array.isArray(result?.object?.questions)
			? result.object.questions
			: null;
	if (!raw) {
		throw new Error('AI service returned unexpected data for the questions');
	}

	return {
		questions: normalizeClarifyingQuestions(raw, prdContent),
		telemetryData: response.telemetryData ?? null
	};
}
