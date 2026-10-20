/**
 * @fileoverview Complexity formatting utilities
 * Provides colored complexity displays with labels and scores
 */

import chalk from 'chalk';
import { theme } from '../theme.js';

/** Score bands, shared by the colored dot and every High/Medium/Low count */
export type ComplexityLevel = 'High' | 'Medium' | 'Low';

/** High is 7-10, Medium 4-6, Low 1-3 */
export function complexityLevel(score: number): ComplexityLevel {
	return score >= 7 ? 'High' : score >= 4 ? 'Medium' : 'Low';
}

/**
 * Get complexity color and label based on score thresholds
 */
function getComplexityLevel(score: number): {
	color: (text: string) => string;
	label: string;
} {
	const label = complexityLevel(score);
	const color =
		label === 'High'
			? chalk.red
			: label === 'Medium'
				? chalk.yellow
				: chalk.green;
	return { color, label };
}

/**
 * Get colored complexity display with dot indicator (simple format)
 */
export function getComplexityWithColor(complexity: number | string): string {
	const score =
		typeof complexity === 'string' ? Number(complexity.trim()) : complexity;

	if (isNaN(score)) {
		return theme.muted('N/A');
	}

	const { color } = getComplexityLevel(score);
	return color(`● ${score}`);
}

/**
 * Get colored complexity display with /10 format (for dashboards)
 */
export function getComplexityWithScore(complexity: number | undefined): string {
	if (typeof complexity !== 'number') {
		return theme.muted('N/A');
	}

	const { color, label } = getComplexityLevel(complexity);
	return color(`${complexity}/10 (${label})`);
}
