/**
 * Path constants for TaskGraph application
 */

// .taskgraph directory structure paths
export const TASKGRAPH_DIR = '.taskgraph';
export const TASKGRAPH_TASKS_DIR = '.taskgraph/tasks';
export const TASKGRAPH_DOCS_DIR = '.taskgraph/docs';
export const TASKGRAPH_REPORTS_DIR = '.taskgraph/reports';
export const TASKGRAPH_TEMPLATES_DIR = '.taskgraph/templates';

// TaskGraph configuration files
export const TASKGRAPH_CONFIG_FILE = '.taskgraph/config.json';
// Per-machine settings merged over config.json; gitignored
export const TASKGRAPH_LOCAL_CONFIG_FILE = '.taskgraph/config.local.json';
export const TASKGRAPH_STATE_FILE = '.taskgraph/state.json';

// TaskGraph report files
export const COMPLEXITY_REPORT_FILE =
	'.taskgraph/reports/task-complexity-report.json';

// TaskGraph PRD file paths
export const PRD_FILE = '.taskgraph/docs/prd.txt';

// TaskGraph template files
export const EXAMPLE_PRD_FILE = '.taskgraph/templates/example_prd.txt';

// TaskGraph task file paths
export const TASKGRAPH_TASKS_FILE = '.taskgraph/tasks/tasks.json';

// General project files (not TaskGraph specific but commonly used)
export const ENV_EXAMPLE_FILE = '.env.example';
export const GITIGNORE_FILE = '.gitignore';

// Task file naming pattern
export const TASK_FILE_PREFIX = 'task_';
export const TASK_FILE_EXTENSION = '.txt';
