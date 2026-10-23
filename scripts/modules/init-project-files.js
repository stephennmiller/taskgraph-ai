/** The files init writes into .taskgraph/ and copies from its templates */
import fs from 'fs';
import path from 'path';
import { stampTasksFileSchemaVersion } from '@tm/core';
import {
	TASKGRAPH_STATE_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';
import { assetExists, readAsset } from '../../src/utils/asset-resolver.js';
import { log } from './init-log.js';

// Function to create directory if it doesn't exist
function ensureDirectoryExists(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		log('debug', `Created directory: ${dirPath}`);
	}
}

// Function to create initial state.json file for tag management
function createInitialStateFile(targetDir) {
	const stateFilePath = path.join(targetDir, TASKGRAPH_STATE_FILE);

	// Check if state.json already exists
	if (fs.existsSync(stateFilePath)) {
		log('debug', 'State file already exists, preserving current configuration');
		return;
	}

	// Create initial state configuration. A new project has nothing to migrate,
	// so the "TaskGraph now supports tags" notice for upgraded projects is
	// marked as shown
	const initialState = {
		currentTag: 'master',
		lastSwitched: new Date().toISOString(),
		branchTagMapping: {},
		migrationNoticeShown: true
	};

	try {
		fs.writeFileSync(stateFilePath, JSON.stringify(initialState, null, 2));
		log('debug', `Created initial state file: ${stateFilePath}`);
	} catch (error) {
		log('error', `Failed to create state file: ${error.message}`);
	}
}

/**
 * Create an empty tasks.json, so adding the first task by hand, listing tags
 * and every other command work before parse-prd has run. An existing file is
 * left alone.
 */
function createInitialTasksFile(targetDir) {
	const tasksPath = path.join(targetDir, TASKGRAPH_TASKS_FILE);
	if (fs.existsSync(tasksPath)) return;

	const emptyTasks = stampTasksFileSchemaVersion({
		master: {
			tasks: [],
			metadata: {
				created: new Date().toISOString(),
				description: 'Tasks for master context'
			}
		}
	});
	try {
		fs.writeFileSync(tasksPath, `${JSON.stringify(emptyTasks, null, 2)}\n`);
		log('debug', `Created empty tasks file: ${tasksPath}`);
	} catch (error) {
		log('error', `Failed to create tasks file: ${error.message}`);
	}
}

// Function to copy a file from the package to the target directory
function copyTemplateFile(templateName, targetPath, replacements = {}) {
	// Get the file content from the appropriate source directory
	// Check if the asset exists
	if (!assetExists(templateName)) {
		log('error', `Source file not found: ${templateName}`);
		return;
	}

	// Read the asset content using the resolver
	let content = readAsset(templateName, 'utf8');

	// Replace placeholders with actual values
	Object.entries(replacements).forEach(([key, value]) => {
		const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
		content = content.replace(regex, value);
	});

	// Handle special files that should be merged instead of overwritten
	if (fs.existsSync(targetPath)) {
		const filename = path.basename(targetPath);

		// Handle .gitignore - append lines that don't exist
		if (filename === '.gitignore') {
			log('debug', `${targetPath} already exists, merging content...`);
			const existingContent = fs.readFileSync(targetPath, 'utf8');
			const existingLines = new Set(
				existingContent.split('\n').map((line) => line.trim())
			);
			const newLines = content
				.split('\n')
				.filter((line) => !existingLines.has(line.trim()));

			if (newLines.length > 0) {
				// Add a comment to separate the original content from our additions
				const updatedContent = `${existingContent.trim()}\n\n# Added by TaskGraph\n${newLines.join('\n')}`;
				fs.writeFileSync(targetPath, updatedContent);
				log('debug', `Updated ${targetPath} with additional entries`);
			} else {
				log('debug', `No new content to add to ${targetPath}`);
			}
			return;
		}

		// Handle README.md - offer to preserve or create a different file
		if (filename === 'README-taskgraph.md') {
			log('debug', `${targetPath} already exists`);
			// Create a separate README file specifically for this project
			const taskGraphReadmePath = path.join(
				path.dirname(targetPath),
				'README-taskgraph.md'
			);
			fs.writeFileSync(taskGraphReadmePath, content);
			log(
				'debug',
				`Created ${taskGraphReadmePath} (preserved original README-taskgraph.md)`
			);
			return;
		}

		// For other files, warn and prompt before overwriting
		log('debug', `${targetPath} already exists, skipping.`);
		return;
	}

	// If the file doesn't exist, create it normally
	fs.writeFileSync(targetPath, content);
	log('debug', `Created file: ${targetPath}`);
}

/**
 * Update config.json with the local file storage configuration
 * @param {string} configPath - Path to config.json file
 */
function updateStorageConfig(configPath) {
	try {
		if (!fs.existsSync(configPath)) {
			log('warn', 'Config file does not exist, skipping storage configuration');
			return;
		}

		const configContent = fs.readFileSync(configPath, 'utf8');
		const config = JSON.parse(configContent);

		// Initialize storage config if it doesn't exist
		if (!config.storage) {
			config.storage = {};
		}

		config.storage.type = 'file';

		// 'solo' selects the standalone slash commands and rules
		config.storage.operatingMode = 'solo';

		log('debug', 'Configured storage for local file storage');

		// Write updated config back to file
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		log('debug', 'Storage configuration updated in config.json');
	} catch (error) {
		log('error', `Failed to update storage configuration: ${error.message}`);
	}
}

export {
	copyTemplateFile,
	createInitialStateFile,
	createInitialTasksFile,
	ensureDirectoryExists,
	updateStorageConfig
};
