/**
 * task-manager.js
 * Task management functions for the TaskGraph CLI
 */

import findNextTask from './task-manager/find-next-task.js';
import parsePRD from './task-manager/parse-prd/index.js';
import setResponseLanguage from './task-manager/response-language.js';

// Export task manager functions
export { parsePRD, findNextTask, setResponseLanguage };
