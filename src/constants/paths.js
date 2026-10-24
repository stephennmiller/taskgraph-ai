/**
 * Path constants for TaskGraph application
 */

// .taskgraph directory structure paths
export const TASKGRAPH_DIR = '.taskgraph';
export const TASKGRAPH_DOCS_DIR = '.taskgraph/docs';
export const TASKGRAPH_REPORTS_DIR = '.taskgraph/reports';

// TaskGraph configuration files
export const TASKGRAPH_CONFIG_FILE = '.taskgraph/config.json';
// Per-machine settings merged over config.json; gitignored
export const TASKGRAPH_LOCAL_CONFIG_FILE = '.taskgraph/config.local.json';

// TaskGraph report files
export const COMPLEXITY_REPORT_FILE =
	'.taskgraph/reports/task-complexity-report.json';

// TaskGraph task file paths
export const TASKGRAPH_TASKS_FILE = '.taskgraph/tasks/tasks.json';
