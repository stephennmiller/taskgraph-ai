/**
 * @fileoverview The scope-up / scope-down prompts, response schemas and the
 * subtask count, as the legacy scripts/modules/task-manager/scope-adjustment.js
 * wrote them. Prompt text is eval-gated: change it only with `npm run evals`.
 */

import { z } from 'zod';
import type { Task } from '../../../common/types/index.js';

export const SCOPE_STRENGTHS = ['light', 'regular', 'heavy'] as const;
export type ScopeStrength = (typeof SCOPE_STRENGTHS)[number];
export type ScopeDirection = 'up' | 'down';

const SCOPE_SYSTEM_PROMPT = `You are an expert software project manager who helps adjust task complexity while maintaining clarity and actionability.`;

const REGENERATE_SYSTEM_PROMPT = `You are an expert project manager who creates task breakdowns that match complexity levels.`;

/** The task's new fields */
export const ScopedTaskSchema = z.object({
	title: z
		.string()
		.min(1)
		.describe('Updated task title reflecting scope adjustment'),
	description: z
		.string()
		.min(1)
		.describe('Updated task description with adjusted scope'),
	details: z
		.string()
		.min(1)
		.describe('Updated implementation details with adjusted complexity'),
	testStrategy: z
		.string()
		.min(1)
		.describe('Updated testing approach for the adjusted scope'),
	priority: z.enum(['low', 'medium', 'high']).describe('Task priority level')
});

/** The subtasks written in place of the pending ones */
export const RegeneratedSubtasksSchema = z.object({
	subtasks: z.array(
		z.object({
			id: z.int().positive(),
			title: z.string().min(5),
			description: z.string().min(10),
			dependencies: z.array(z.string()),
			details: z.string().min(20),
			status: z.string(),
			testStrategy: z.string()
		})
	)
});

export function scopeTaskPrompt(
	task: Task,
	direction: ScopeDirection,
	strength: ScopeStrength,
	customPrompt?: string
): { systemPrompt: string; prompt: string } {
	const isUp = direction === 'up';
	const strengthDescriptions: Record<ScopeStrength, string> = {
		light: isUp ? 'minor enhancements' : 'slight simplifications',
		regular: isUp
			? 'moderate complexity increases'
			: 'moderate simplifications',
		heavy: isUp ? 'significant complexity additions' : 'major simplifications'
	};

	let basePrompt = `You are tasked with adjusting the complexity of a task. 

CURRENT TASK:
Title: ${task.title}
Description: ${task.description}
Details: ${task.details}
Test Strategy: ${task.testStrategy || 'Not specified'}

ADJUSTMENT REQUIREMENTS:
- Direction: ${isUp ? 'INCREASE' : 'DECREASE'} complexity
- Strength: ${strength} (${strengthDescriptions[strength]})
- Preserve the core purpose and functionality of the task
- Maintain consistency with the existing task structure`;

	if (isUp) {
		basePrompt += `
- Add more detailed requirements, edge cases, or advanced features
- Include additional implementation considerations
- Enhance error handling and validation requirements
- Expand testing strategies with more comprehensive scenarios`;
	} else {
		basePrompt += `
- Focus on core functionality and essential requirements
- Remove or simplify non-essential features  
- Streamline implementation details
- Simplify testing to focus on basic functionality`;
	}

	if (customPrompt) {
		basePrompt += `\n\nCUSTOM INSTRUCTIONS:\n${customPrompt}`;
	}

	basePrompt += `\n\nReturn a JSON object with the updated task containing these fields:
- title: Updated task title
- description: Updated task description  
- details: Updated implementation details
- testStrategy: Updated test strategy
- priority: Task priority ('low', 'medium', or 'high')

Ensure the JSON is valid and properly formatted.`;

	return { systemPrompt: SCOPE_SYSTEM_PROMPT, prompt: basePrompt };
}

/**
 * How many subtasks the task should have once scoped: more going up, fewer
 * going down, scaled by strength and the report's score when there is one
 */
export function targetSubtaskCount(
	direction: ScopeDirection,
	strength: ScopeStrength,
	preservedCount: number,
	currentPendingCount: number,
	originalComplexity: number | null
): number {
	let targetSubtaskCount: number;
	// Use original complexity to inform decisions (if available)
	const complexityFactor = originalComplexity
		? Math.max(0.5, originalComplexity / 10)
		: 1.0;
	const score = originalComplexity ?? 0;

	if (direction === 'up') {
		// Scope up: More subtasks for increased complexity
		if (strength === 'light') {
			const base = Math.max(
				5,
				preservedCount + Math.ceil(currentPendingCount * 1.1)
			);
			targetSubtaskCount = Math.ceil(base * (0.8 + 0.4 * complexityFactor));
		} else if (strength === 'regular') {
			const base = Math.max(
				6,
				preservedCount + Math.ceil(currentPendingCount * 1.3)
			);
			targetSubtaskCount = Math.ceil(base * (0.8 + 0.4 * complexityFactor));
		} else {
			// heavy
			const base = Math.max(
				8,
				preservedCount + Math.ceil(currentPendingCount * 1.6)
			);
			targetSubtaskCount = Math.ceil(base * (0.8 + 0.6 * complexityFactor));
		}
	} else {
		// Scope down: Fewer subtasks for decreased complexity
		// High complexity tasks get reduced more aggressively
		const aggressiveFactor =
			score >= 8 ? 0.7 : score >= 6 ? 0.85 : 1.0;

		if (strength === 'light') {
			const base = Math.max(
				3,
				preservedCount + Math.ceil(currentPendingCount * 0.8)
			);
			targetSubtaskCount = Math.ceil(base * aggressiveFactor);
		} else if (strength === 'regular') {
			const base = Math.max(
				3,
				preservedCount + Math.ceil(currentPendingCount * 0.5)
			);
			targetSubtaskCount = Math.ceil(base * aggressiveFactor);
		} else {
			// heavy
			// Heavy scope-down should be much more aggressive - aim for only core functionality
			// Very high complexity tasks (9-10) get reduced to almost nothing
			const ultraAggressiveFactor =
				score >= 9 ? 0.3 : score >= 7 ? 0.5 : 0.7;
			const base = Math.max(
				2,
				preservedCount + Math.ceil(currentPendingCount * 0.25)
			);
			targetSubtaskCount = Math.max(1, Math.ceil(base * ultraAggressiveFactor));
		}
	}
	return targetSubtaskCount;
}

export function regenerateSubtasksPrompt(
	task: Task,
	direction: ScopeDirection,
	strength: ScopeStrength,
	newSubtasksNeeded: number,
	preservedCount: number,
	originalComplexity: number | null
): { systemPrompt: string; prompt: string } {
	const prompt = `Based on this updated task, generate ${newSubtasksNeeded} NEW subtasks that reflect the ${direction === 'up' ? 'increased' : 'decreased'} complexity level:

**Task Title**: ${task.title}
**Task Description**: ${task.description}
**Implementation Details**: ${task.details}
**Test Strategy**: ${task.testStrategy}

**Complexity Direction**: This task was recently scoped ${direction} (${strength} strength) to ${direction === 'up' ? 'increase' : 'decrease'} complexity.
${originalComplexity ? `**Original Complexity**: ${originalComplexity}/10 - consider this when determining appropriate scope level.` : ''}

${preservedCount > 0 ? `**Preserved Subtasks**: ${preservedCount} existing subtasks with work already done will be kept.` : ''}

Generate subtasks that:
${
	direction === 'up'
		? strength === 'heavy'
			? `- Add comprehensive implementation steps with advanced features
- Include extensive error handling, validation, and edge cases
- Cover multiple integration scenarios and advanced testing
- Provide thorough documentation and optimization approaches`
			: strength === 'regular'
				? `- Add more detailed implementation steps
- Include additional error handling and validation
- Cover more edge cases and advanced features
- Provide more comprehensive testing approaches`
				: `- Add some additional implementation details
- Include basic error handling considerations
- Cover a few common edge cases
- Enhance testing approaches slightly`
		: strength === 'heavy'
			? `- Focus ONLY on absolutely essential core functionality
- Strip out ALL non-critical features (error handling, advanced testing, etc.)
- Provide only the minimum viable implementation
- Eliminate any complex integrations or advanced scenarios
- Aim for the simplest possible working solution`
			: strength === 'regular'
				? `- Focus on core functionality only
- Simplify implementation steps
- Remove non-essential features
- Streamline to basic requirements`
				: `- Focus mainly on core functionality
- Slightly simplify implementation steps
- Remove some non-essential features
- Streamline most requirements`
}

Return a JSON object with a "subtasks" array. Each subtask should have:
- id: Sequential NUMBER starting from 1 (e.g., 1, 2, 3 - NOT "1", "2", "3")
- title: Clear, specific title
- description: Detailed description
- dependencies: Array of dependency IDs as STRINGS (use format ["${task.id}.1", "${task.id}.2"] for siblings, or empty array [] for no dependencies)
- details: Implementation guidance
- status: "pending"
- testStrategy: Testing approach

IMPORTANT: 
- The 'id' field must be a NUMBER, not a string!
- Dependencies must be strings, not numbers!

Ensure the JSON is valid and properly formatted.`;

	return { systemPrompt: REGENERATE_SYSTEM_PROMPT, prompt };
}
