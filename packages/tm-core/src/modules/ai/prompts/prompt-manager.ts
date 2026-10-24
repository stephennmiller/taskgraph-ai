import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import { getLogger } from '../../../common/logger/index.js';
import { getRepoSummary } from '../../codebase/index.js';

import addTaskPrompt from './add-task.json' with { type: 'json' };
// Import all prompt templates directly
import analyzeComplexityPrompt from './analyze-complexity.json' with {
	type: 'json'
};
import expandTaskPrompt from './expand-task.json' with { type: 'json' };
import parsePrdPrompt from './parse-prd.json' with { type: 'json' };
import parsePrdClarifyPrompt from './parse-prd-clarify.json' with {
	type: 'json'
};
import researchPrompt from './research.json' with { type: 'json' };
import updateSubtaskPrompt from './update-subtask.json' with { type: 'json' };
import updateTaskPrompt from './update-task.json' with { type: 'json' };
import updateTasksPrompt from './update-tasks.json' with { type: 'json' };

// Import schema for validation
import promptTemplateSchema from './schemas/prompt-template.schema.json' with {
	type: 'json'
};

const require = createRequire(import.meta.url);
const logger = getLogger('PromptManager');

type PromptVariables = Record<string, any>;

interface PromptParameter {
	type: string;
	required?: boolean;
	enum?: unknown[];
	pattern?: string;
	minimum?: number;
	maximum?: number;
}

interface PromptVariant {
	system: string;
	user: string;
	condition?: string;
}

/** A prompt template as stored in this folder's `*.json` files */
interface PromptTemplate {
	id: string;
	version: string;
	description: string;
	parameters?: Record<string, PromptParameter>;
	prompts: Record<string, PromptVariant>;
	metadata?: { tags?: string[] };
}

interface RenderedPrompt {
	systemPrompt: string;
	userPrompt: string;
	metadata: {
		templateId: string;
		version: string;
		variant: string;
		parameters: PromptVariables;
	};
}

const schemaErrors = (validate: ValidateFunction) =>
	(validate.errors ?? [])
		.map((err) => `${err.instancePath || 'root'}: ${err.message}`)
		.join(', ');

/**
 * Add the project summary to a prompt that lets the model read the codebase,
 * so it can plan from the summary instead of exploring with tools first.
 */
function withRepoSummary(variables: PromptVariables): PromptVariables {
	if (
		!variables.hasCodebaseAnalysis ||
		!variables.projectRoot ||
		variables.repoSummary !== undefined
	) {
		return variables;
	}
	let repoSummary: string;
	try {
		repoSummary = getRepoSummary(variables.projectRoot);
	} catch (error) {
		logger.debug(`No project summary: ${(error as Error).message}`);
		repoSummary = 'No project summary is available.';
	}
	return { ...variables, repoSummary };
}

/**
 * Manages prompt templates for AI interactions
 */
export class PromptManager {
	readonly prompts: Map<string, PromptTemplate>;
	readonly cache = new Map<string, RenderedPrompt>();
	validatePrompt?: ValidateFunction | ((data: unknown) => boolean);

	constructor() {
		// Store all prompts in a map for easy lookup
		this.prompts = new Map<string, PromptTemplate>([
			['analyze-complexity', analyzeComplexityPrompt],
			['expand-task', expandTaskPrompt],
			['add-task', addTaskPrompt],
			['research', researchPrompt],
			['parse-prd', parsePrdPrompt],
			['parse-prd-clarify', parsePrdClarifyPrompt],
			['update-task', updateTaskPrompt],
			['update-tasks', updateTasksPrompt],
			['update-subtask', updateSubtaskPrompt]
		]);

		this.setupValidation();
	}

	/**
	 * Set up JSON schema validation
	 */
	private setupValidation() {
		// ajv loads here, not at the top, so commands that never build a
		// prompt skip it (#248)
		const { default: Ajv } = require('ajv');
		const { default: addFormats } = require('ajv-formats');
		const ajv = new Ajv({ allErrors: true, strict: false });
		addFormats(ajv);

		try {
			// Use the imported schema directly
			this.validatePrompt = ajv.compile(promptTemplateSchema);
			logger.debug('✓ JSON schema validation enabled');
		} catch (error) {
			logger.warn(`⚠ Schema validation disabled: ${(error as Error).message}`);
			this.validatePrompt = () => true; // Fallback to no validation
		}
	}

	/**
	 * Load a prompt template and render it with variables
	 * @param promptId - The prompt template ID
	 * @param variables - Variables to inject into the template
	 * @param variantKey - Optional specific variant to use
	 */
	loadPrompt(
		promptId: string,
		variables: PromptVariables = {},
		variantKey: string | null = null
	): RenderedPrompt {
		try {
			variables = withRepoSummary(variables);

			// Check cache first
			const cacheKey = `${promptId}-${JSON.stringify(variables)}-${variantKey}`;
			if (this.cache.has(cacheKey)) {
				return this.cache.get(cacheKey)!;
			}

			// Load template
			const template = this.loadTemplate(promptId);

			// Validate parameters if schema validation is available
			if (this.validatePrompt) {
				this.validateParameters(template, variables);
			}

			// Select the variant - use specified key or select based on conditions
			const variant = variantKey
				? { ...template.prompts[variantKey], name: variantKey }
				: this.selectVariant(template, variables);

			// Render the prompts with variables
			const rendered: RenderedPrompt = {
				systemPrompt: this.renderTemplate(variant.system, variables),
				userPrompt: this.renderTemplate(variant.user, variables),
				metadata: {
					templateId: template.id,
					version: template.version,
					variant: variant.name || 'default',
					parameters: variables
				}
			};

			// Cache the result
			this.cache.set(cacheKey, rendered);

			return rendered;
		} catch (error) {
			logger.error(
				`Failed to load prompt ${promptId}: ${(error as Error).message}`
			);
			throw error;
		}
	}

	/**
	 * Load a prompt template from the imported prompts
	 */
	private loadTemplate(promptId: string): PromptTemplate {
		// Get template from the map
		const template = this.prompts.get(promptId);

		if (!template) {
			throw new Error(`Prompt template '${promptId}' not found`);
		}

		// Schema validation if available (do this first for detailed errors)
		if (this.validatePrompt) {
			const valid = this.validatePrompt(template);
			if (!valid) {
				const errors = schemaErrors(this.validatePrompt as ValidateFunction);
				throw new Error(`Schema validation failed: ${errors}`);
			}
		} else {
			// Fallback basic validation if no schema validation available
			if (!template.id || !template.prompts || !template.prompts.default) {
				throw new Error(
					'Invalid template structure: missing required fields (id, prompts.default)'
				);
			}
		}

		return template;
	}

	/**
	 * Validate parameters against template schema
	 */
	private validateParameters(
		template: PromptTemplate,
		variables: PromptVariables
	) {
		if (!template.parameters) return;

		const errors: string[] = [];

		for (const [paramName, paramConfig] of Object.entries(
			template.parameters
		)) {
			const value = variables[paramName];

			// Check required parameters
			if (paramConfig.required && value === undefined) {
				errors.push(`Required parameter '${paramName}' missing`);
				continue;
			}

			// Skip validation for undefined optional parameters
			if (value === undefined) continue;

			// Type validation
			if (!this.validateParameterType(value, paramConfig.type)) {
				errors.push(
					`Parameter '${paramName}' expected ${paramConfig.type}, got ${typeof value}`
				);
			}

			// Enum validation
			if (paramConfig.enum && !paramConfig.enum.includes(value)) {
				errors.push(
					`Parameter '${paramName}' must be one of: ${paramConfig.enum.join(', ')}`
				);
			}

			// Pattern validation for strings
			if (paramConfig.pattern && typeof value === 'string') {
				const regex = new RegExp(paramConfig.pattern);
				if (!regex.test(value)) {
					errors.push(
						`Parameter '${paramName}' does not match required pattern: ${paramConfig.pattern}`
					);
				}
			}

			// Range validation for numbers
			if (typeof value === 'number') {
				if (paramConfig.minimum !== undefined && value < paramConfig.minimum) {
					errors.push(
						`Parameter '${paramName}' must be >= ${paramConfig.minimum}`
					);
				}
				if (paramConfig.maximum !== undefined && value > paramConfig.maximum) {
					errors.push(
						`Parameter '${paramName}' must be <= ${paramConfig.maximum}`
					);
				}
			}
		}

		if (errors.length > 0) {
			throw new Error(`Parameter validation failed: ${errors.join('; ')}`);
		}
	}

	/**
	 * Validate parameter type
	 */
	private validateParameterType(value: unknown, expectedType: string) {
		switch (expectedType) {
			case 'string':
				return typeof value === 'string';
			case 'number':
				return typeof value === 'number';
			case 'boolean':
				return typeof value === 'boolean';
			case 'array':
				return Array.isArray(value);
			case 'object':
				return (
					typeof value === 'object' && value !== null && !Array.isArray(value)
				);
			default:
				return true;
		}
	}

	/**
	 * Select the best variant based on conditions
	 */
	private selectVariant(template: PromptTemplate, variables: PromptVariables) {
		// Check each variant's condition
		for (const [name, variant] of Object.entries(template.prompts)) {
			if (name === 'default') continue;

			if (
				variant.condition &&
				this.evaluateCondition(variant.condition, variables)
			) {
				return { ...variant, name };
			}
		}

		// Fall back to default
		return { ...template.prompts.default, name: 'default' };
	}

	/**
	 * Evaluate a condition string
	 */
	private evaluateCondition(condition: string, variables: PromptVariables) {
		try {
			// Create a safe evaluation context
			const context = { ...variables };

			// Simple condition evaluation (can be enhanced)
			// For now, supports basic comparisons
			const func = new Function(...Object.keys(context), `return ${condition}`);
			return func(...Object.values(context));
		} catch {
			logger.warn(`Failed to evaluate condition: ${condition}`);
			return false;
		}
	}

	/**
	 * Render a template string with variables
	 */
	renderTemplate(template: string, variables: PromptVariables): string {
		let rendered = template;

		// Handle helper functions like (eq variable "value")
		rendered = rendered.replace(
			/\(eq\s+(\w+(?:\.\w+)*)\s+"([^"]+)"\)/g,
			(_match, path, compareValue) => {
				const value = this.getNestedValue(variables, path);
				return value === compareValue ? 'true' : 'false';
			}
		);

		// Handle not helper function like (not variable)
		rendered = rendered.replace(
			/\(not\s+(\w+(?:\.\w+)*)\)/g,
			(_match, path) => {
				const value = this.getNestedValue(variables, path);
				return !value ? 'true' : 'false';
			}
		);

		// Handle gt (greater than) helper function like (gt variable 0)
		rendered = rendered.replace(
			/\(gt\s+(\w+(?:\.\w+)*)\s+(\d+(?:\.\d+)?)\)/g,
			(_match, path, compareValue) => {
				const value = this.getNestedValue(variables, path);
				const numValue = parseFloat(compareValue);
				return typeof value === 'number' && value > numValue ? 'true' : 'false';
			}
		);

		// Handle gte (greater than or equal) helper function like (gte variable 0)
		rendered = rendered.replace(
			/\(gte\s+(\w+(?:\.\w+)*)\s+(\d+(?:\.\d+)?)\)/g,
			(_match, path, compareValue) => {
				const value = this.getNestedValue(variables, path);
				const numValue = parseFloat(compareValue);
				return typeof value === 'number' && value >= numValue
					? 'true'
					: 'false';
			}
		);

		// Handle conditionals with else {{#if variable}}...{{else}}...{{/if}}
		rendered = rendered.replace(
			/\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
			(_match, condition, trueContent, falseContent = '') => {
				// Handle boolean values and helper function results
				let value;
				if (condition === 'true') {
					value = true;
				} else if (condition === 'false') {
					value = false;
				} else {
					value = this.getNestedValue(variables, condition);
				}
				return value ? trueContent : falseContent;
			}
		);

		// Handle each loops {{#each array}}...{{/each}}
		rendered = rendered.replace(
			/\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
			(_match, path, content) => {
				const array = this.getNestedValue(variables, path);
				if (!Array.isArray(array)) return '';

				return array
					.map((item: unknown, index: number) => {
						// Create a context with item properties and special variables
						const itemContext = {
							...variables,
							...(item as object),
							'@index': index,
							'@first': index === 0,
							'@last': index === array.length - 1
						};

						// Recursively render the content with item context
						return this.renderTemplate(content, itemContext);
					})
					.join('');
			}
		);

		// Handle json helper {{{json variable}}} (triple braces for raw output)
		rendered = rendered.replace(
			/\{\{\{json\s+(\w+(?:\.\w+)*)\}\}\}/g,
			(_match, path) => {
				const value = this.getNestedValue(variables, path);
				return value !== undefined ? JSON.stringify(value, null, 2) : '';
			}
		);

		// Handle variable substitution {{variable}}
		rendered = rendered.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path) => {
			const value = this.getNestedValue(variables, path);
			return value !== undefined ? String(value) : '';
		});

		return rendered;
	}

	/**
	 * Get nested value from object using dot notation
	 */
	private getNestedValue(obj: PromptVariables, path: string): any {
		return path
			.split('.')
			.reduce(
				(current: any, key) =>
					current && current[key] !== undefined ? current[key] : undefined,
				obj
			);
	}

	/**
	 * Validate all prompt templates
	 */
	validateAllPrompts() {
		const results = {
			total: 0,
			errors: [] as string[],
			valid: [] as string[]
		};

		// Iterate through all imported prompts
		for (const [promptId, template] of this.prompts.entries()) {
			results.total++;

			try {
				// Validate the template
				if (this.validatePrompt) {
					const valid = this.validatePrompt(template);
					if (!valid) {
						const errors = schemaErrors(
							this.validatePrompt as ValidateFunction
						);
						throw new Error(`Schema validation failed: ${errors}`);
					}
				}
				results.valid.push(promptId);
			} catch (error) {
				results.errors.push(`${promptId}: ${(error as Error).message}`);
			}
		}

		return results;
	}

	/**
	 * List all available prompt templates
	 */
	listPrompts() {
		const prompts = [];

		// Iterate through all imported prompts
		for (const [promptId, template] of this.prompts.entries()) {
			try {
				prompts.push({
					id: template.id,
					description: template.description,
					version: template.version,
					parameters: template.parameters,
					tags: template.metadata?.tags || []
				});
			} catch (error) {
				logger.warn(
					`Failed to process template ${promptId}: ${(error as Error).message}`
				);
			}
		}

		return prompts;
	}

	/**
	 * Validate template structure
	 * @param templateOrId - Either a template ID or a template object
	 */
	validateTemplate(templateOrId: string | PromptTemplate): {
		valid: boolean;
		error?: string;
	} {
		try {
			let template: PromptTemplate | undefined;

			// Handle both template ID and direct template object
			if (typeof templateOrId === 'string') {
				template = this.prompts.get(templateOrId);
				if (!template) {
					return {
						valid: false,
						error: `Template '${templateOrId}' not found`
					};
				}
			} else {
				template = templateOrId;
			}

			// Check required fields
			const required = ['id', 'version', 'description', 'prompts'] as const;
			for (const field of required) {
				if (!template[field]) {
					return { valid: false, error: `Missing required field: ${field}` };
				}
			}

			// Check default prompt exists
			if (!template.prompts.default) {
				return { valid: false, error: 'Missing default prompt variant' };
			}

			// Check each variant has required fields
			for (const [name, variant] of Object.entries(template.prompts)) {
				if (!variant.system || !variant.user) {
					return {
						valid: false,
						error: `Variant '${name}' missing system or user prompt`
					};
				}
			}

			// Schema validation if available
			if (this.validatePrompt) {
				const valid = this.validatePrompt(template);
				if (!valid) {
					const errors = schemaErrors(this.validatePrompt as ValidateFunction);
					return { valid: false, error: `Schema validation failed: ${errors}` };
				}
			}

			return { valid: true };
		} catch (error) {
			return { valid: false, error: (error as Error).message };
		}
	}
}

// Singleton instance
let promptManager: PromptManager | null = null;

/**
 * Get or create the prompt manager instance
 */
export function getPromptManager(): PromptManager {
	if (!promptManager) {
		promptManager = new PromptManager();
	}
	return promptManager;
}
