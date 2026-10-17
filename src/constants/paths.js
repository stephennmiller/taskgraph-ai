/**
 * Path constants for TaskGraph application
 */

// .taskmaster directory structure paths
export const TASKMASTER_DIR = '.taskmaster';
export const TASKMASTER_TASKS_DIR = '.taskmaster/tasks';
export const TASKMASTER_DOCS_DIR = '.taskmaster/docs';
export const TASKMASTER_REPORTS_DIR = '.taskmaster/reports';
export const TASKMASTER_TEMPLATES_DIR = '.taskmaster/templates';

// TaskGraph configuration files
export const TASKMASTER_CONFIG_FILE = '.taskmaster/config.json';
export const TASKMASTER_STATE_FILE = '.taskmaster/state.json';
export const LEGACY_CONFIG_FILE = '.taskmasterconfig';

// TaskGraph report files
export const COMPLEXITY_REPORT_FILE =
	'.taskmaster/reports/task-complexity-report.json';
export const LEGACY_COMPLEXITY_REPORT_FILE =
	'scripts/task-complexity-report.json';

// TaskGraph PRD file paths
export const PRD_FILE = '.taskmaster/docs/prd.txt';
export const LEGACY_PRD_FILE = 'scripts/prd.txt';

// TaskGraph template files
export const EXAMPLE_PRD_FILE = '.taskmaster/templates/example_prd.txt';
export const LEGACY_EXAMPLE_PRD_FILE = 'scripts/example_prd.txt';

// TaskGraph task file paths
export const TASKMASTER_TASKS_FILE = '.taskmaster/tasks/tasks.json';
export const LEGACY_TASKS_FILE = 'tasks/tasks.json';

// General project files (not TaskGraph specific but commonly used)
export const ENV_EXAMPLE_FILE = '.env.example';
export const GITIGNORE_FILE = '.gitignore';

// Task file naming pattern
export const TASK_FILE_PREFIX = 'task_';
export const TASK_FILE_EXTENSION = '.txt';

/**
 * Project markers used to identify a taskgraph project root
 * These files/directories indicate that a directory is a TaskGraph project
 */
export const PROJECT_MARKERS = [
	'.taskmaster', // New taskmaster directory
	LEGACY_CONFIG_FILE, // .taskmasterconfig
	'tasks.json', // Generic tasks file
	LEGACY_TASKS_FILE, // tasks/tasks.json (legacy location)
	TASKMASTER_TASKS_FILE, // .taskmaster/tasks/tasks.json (new location)
	'.git', // Git repository
	'.svn' // SVN repository
];
