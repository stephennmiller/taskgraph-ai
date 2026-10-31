/**
 * @fileoverview Runtime State Manager Service
 * Manages runtime state separate from configuration
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { DEFAULT_CONFIG_VALUES } from '../../../common/interfaces/configuration.interface.js';
import { getLogger } from '../../../common/logger/index.js';
import { FileOperations } from '../../storage/adapters/file-storage/file-operations.js';
import type { EnvMap } from './project-env.js';

/**
 * Runtime state data structure
 */
export interface RuntimeState {
	/** Currently active tag */
	currentTag: string;
	/** Last updated timestamp */
	lastUpdated?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * The error for a state.json that can't be read or saved. It names the file
 * and the way out: a corrupt state.json is never overwritten.
 */
export function stateFileError(
	verb: 'read' | 'save',
	statePath: string,
	error: unknown
): TaskGraphError {
	// The path goes in the message itself: MCP replies show only the message
	return Object.assign(
		new TaskGraphError(
			`Couldn't ${verb} ${statePath}: ${(error as Error).message}`,
			ERROR_CODES.CONFIG_ERROR,
			{ statePath },
			error as Error
		),
		{
			hint: 'Fix the file, or delete it: it holds only the current tag and branch-tag mappings'
		}
	);
}

/**
 * RuntimeStateManager handles runtime state persistence
 * Single responsibility: Runtime state management (separate from config)
 */
export class RuntimeStateManager {
	private stateFilePath: string;
	private currentState: RuntimeState;
	private readonly logger = getLogger('RuntimeStateManager');

	constructor(
		projectRoot: string,
		private readonly env: EnvMap = process.env
	) {
		this.stateFilePath = path.join(projectRoot, '.taskgraph', 'state.json');
		this.currentState = {
			currentTag: DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG
		};
	}

	/**
	 * Load runtime state from disk
	 * @throws {TaskGraphError} when state.json exists but can't be read, so a
	 * broken file doesn't silently switch the current tag to master
	 */
	async loadState(): Promise<RuntimeState> {
		try {
			const stateData = await fs.readFile(this.stateFilePath, 'utf-8');
			const rawState = JSON.parse(stateData);

			// Map legacy field names to current interface
			const state: RuntimeState = {
				currentTag:
					rawState.currentTag ||
					rawState.activeTag ||
					DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG,
				lastUpdated: rawState.lastUpdated,
				metadata: rawState.metadata
			};

			// Apply environment variable override for current tag
			if (this.env.TASKGRAPH_TAG) {
				state.currentTag = this.env.TASKGRAPH_TAG;
			}

			this.currentState = state;
			return state;
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				// State file doesn't exist, use defaults
				this.logger.debug('No state.json found, using default state');

				// Check environment variable
				if (this.env.TASKGRAPH_TAG) {
					this.currentState.currentTag = this.env.TASKGRAPH_TAG;
				}

				return this.currentState;
			}

			throw stateFileError('read', this.stateFilePath, error);
		}
	}

	/**
	 * Save runtime state to disk
	 */
	async saveState(): Promise<void> {
		try {
			// Under the file lock, keeping keys this class doesn't manage
			// (branchTagMapping, lastSwitched, ...) as another writer left them
			await new FileOperations().modifyJson(
				this.stateFilePath,
				(existing: Record<string, unknown>) => ({
					...existing,
					...this.currentState,
					lastUpdated: new Date().toISOString()
				})
			);
		} catch (error) {
			throw stateFileError('save', this.stateFilePath, error);
		}
	}

	/**
	 * Get the currently active tag
	 */
	getCurrentTag(): string {
		return this.currentState.currentTag;
	}

	/**
	 * Set the current tag
	 */
	async setCurrentTag(tag: string): Promise<void> {
		this.currentState.currentTag = tag;
		await this.saveState();
	}

	/**
	 * Get current state
	 */
	getState(): RuntimeState {
		return { ...this.currentState };
	}

	/**
	 * Update metadata
	 */
	async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
		this.currentState.metadata = {
			...this.currentState.metadata,
			...metadata
		};
		await this.saveState();
	}

	/**
	 * Clear state file
	 */
	async clearState(): Promise<void> {
		try {
			await fs.unlink(this.stateFilePath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
		this.currentState = {
			currentTag: DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG
		};
	}
}
