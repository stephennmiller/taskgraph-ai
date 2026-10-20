/**
 * @fileoverview Type definitions for model setup
 */

import type { ModelRoleName } from '../../ui/formatters/model-formatters.js';

/** A model role: main, research or fallback */
export type ModelRole = ModelRoleName;

/** A model the roles can use, from supported-models.json */
export interface ModelInfo {
	id: string;
	allowed_roles: ModelRole[];
}
