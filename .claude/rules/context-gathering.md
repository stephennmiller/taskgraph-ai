---
description: Standardized patterns for gathering and processing context from multiple sources in TaskGraph commands, particularly for AI-powered features.
paths:
  - "scripts/modules/utils/context-gatherer.js"
  - "scripts/modules/task-manager/**/*.js"
---
# Context Gathering Patterns and Utilities

This document outlines the standardized patterns for gathering and processing context from multiple sources in TaskGraph commands, particularly for AI-powered features.

## Core Context Gathering Utility

The `ContextGatherer` class (`scripts/modules/utils/contextGatherer.js`) provides a centralized, reusable utility for extracting context from multiple sources:

### **Key Features**
- **Multi-source Context**: Tasks, files, custom text, project file tree
- **Token Counting**: Estimated breakdown (about 4 characters per token)
- **Format Support**: Different output formats (research, chat, system-prompt)
- **Error Handling**: Graceful handling of missing files, invalid task IDs
- **Performance**: File size limits, depth limits for tree generation

### **Usage Pattern**
```javascript
import { ContextGatherer } from '../utils/contextGatherer.js';

// Initialize with project paths
const gatherer = new ContextGatherer(projectRoot, tasksPath);

// Gather context with detailed token breakdown
const result = await gatherer.gather({
    tasks: ['15', '16.2'],           // Task and subtask IDs
    files: ['src/api.js', 'README.md'], // File paths
    customContext: 'Additional context text',
    includeProjectTree: true,        // Include file tree
    format: 'research',              // Output format
    includeTokenCounts: true         // Get detailed token breakdown
});

// Access results
const contextString = result.context;
const tokenBreakdown = result.tokenBreakdown;
```

### **Token Breakdown Structure**
```javascript
{
    customContext: { tokens: 150, characters: 800 },
    tasks: [
        { id: '15', type: 'task', title: 'Task Title', tokens: 245, characters: 1200 },
        { id: '16.2', type: 'subtask', title: 'Subtask Title', tokens: 180, characters: 900 }
    ],
    files: [
        { path: 'src/api.js', tokens: 890, characters: 4500, size: '4.5 KB' }
    ],
    projectTree: { tokens: 320, characters: 1600 },
    total: { tokens: 1785, characters: 8000 }
}
```

## Fuzzy Search Integration

The `FuzzyTaskSearch` class (`scripts/modules/utils/fuzzyTaskSearch.js`) provides intelligent task discovery:

### **Key Features**
- **Semantic Matching**: Uses Fuse.js for similarity scoring
- **Purpose Categories**: Pattern-based task categorization
- **Relevance Scoring**: High/medium/low relevance thresholds
- **Context-Aware**: Different search configurations for different use cases

### **Usage Pattern**
```javascript
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';

// Initialize with tasks data and context
const fuzzySearch = new FuzzyTaskSearch(tasksData.tasks, 'research');

// Find relevant tasks
const searchResults = fuzzySearch.findRelevantTasks(query, {
    maxResults: 8,
    includeRecent: true,
    includeCategoryMatches: true
});

// Get task IDs for context gathering
const taskIds = fuzzySearch.getTaskIds(searchResults);
```

## Implementation Patterns for Commands

### **1. Context-Aware Command Structure**
```javascript
// In command action handler
async function commandAction(prompt, options) {
    // 1. Parameter validation and parsing
    const taskIds = options.id ? parseTaskIds(options.id) : [];
    const filePaths = options.files ? parseFilePaths(options.files) : [];
    
    // 2. Initialize context gatherer
    const projectRoot = findProjectRoot() || '.';
    const tasksPath = path.join(projectRoot, 'tasks', 'tasks.json');
    const gatherer = new ContextGatherer(projectRoot, tasksPath);
    
    // 3. Auto-discover relevant tasks if none specified
    if (taskIds.length === 0) {
        const fuzzySearch = new FuzzyTaskSearch(tasksData.tasks, 'research');
        const discoveredIds = fuzzySearch.getTaskIds(
            fuzzySearch.findRelevantTasks(prompt)
        );
        taskIds.push(...discoveredIds);
    }
    
    // 4. Gather context with token breakdown
    const contextResult = await gatherer.gather({
        tasks: taskIds,
        files: filePaths,
        customContext: options.context,
        includeProjectTree: options.projectTree,
        format: 'research',
        includeTokenCounts: true
    });
    
    // 5. One muted line saying what context was used (CLI only)
    if (outputFormat === 'text') {
        console.log(ui.formatResearchContext({ taskIds, relatedTaskIds, files: filePaths }));
    }
    
    // 6. Use context in AI call, behind a spinner
    const aiResult = await generateTextService({ role, session, systemPrompt, prompt: userPrompt });
    
    // 7. Print the answer once, rendered, then the AI usage line
    console.log(ui.formatResearchAnswer(aiResult.mainResult));
    displayAiUsageSummary(aiResult.telemetryData, 'cli');
}
```

### **2. What to Show the User**

`research` is the reference (`scripts/modules/task-manager/research.js`, formatters in `apps/cli/src/ui/formatters/research-formatters.ts`):

```
Context: task 3 · related 1, 2, 4 · README.md · project tree
⠋ Researching… 12s

<the answer, rendered to the terminal width>

sonnet · 13,735 tokens (12,188 in, 1,547 out) · 100% cached
```

- ✅ **DO**: One muted context line (`ui.formatResearchContext`)
- ✅ **DO**: A spinner with the elapsed time while the model runs
- ✅ **DO**: Print the answer once, rendered (`ui.formatResearchAnswer`)
- ✅ **DO**: End with `displayAiUsageSummary`, which has the real token counts
- ❌ **DON'T**: Print a per-task token table or "Context Analysis" box. The counts are estimates, and the usage line already reports what was used
- ❌ **DON'T**: Stream raw text and then print the same answer again in a box
- ❌ **DON'T**: Add header boxes repeating the query the user just typed

Token counts from `ContextGatherer` are still useful internally (logging, MCP responses); just don't print them as a table.

## Rendering Markdown Answers

Render model answers with `ui.formatResearchAnswer(markdown, width)`. It renders with its own `Marked` instance, so it doesn't change the global `marked` that `show` uses. It wraps to the terminal width, capped at 100 columns, renders inline markdown inside list items, and drops `<think>` blocks. Don't box the result or reformat code blocks by hand.

## Integration Guidelines

### **When to Use Context Gathering**
- ✅ **DO**: Use for AI-powered commands that benefit from project context
- ✅ **DO**: Use when users might want to reference specific tasks or files
- ✅ **DO**: Use for research, analysis, or generation commands
- ❌ **DON'T**: Use for simple CRUD operations that don't need AI context

### **Performance Considerations**
- ✅ **DO**: Set reasonable file size limits (50KB default)
- ✅ **DO**: Limit project tree depth (3-5 levels)
- ✅ **DO**: Keep token counts for logs and MCP responses; the CLI shows them in the usage line
- ✅ **DO**: Allow users to control what context is included

### **Error Handling**
- ✅ **DO**: Gracefully handle missing files with warnings
- ✅ **DO**: Validate task IDs and provide helpful error messages
- ✅ **DO**: Continue processing even if some context sources fail
- ✅ **DO**: Provide fallback behavior when context gathering fails

### **Future Command Integration**
Commands that should consider adopting this pattern:
- `analyze-complexity` - Could benefit from file context
- `expand-task` - Could use related task context
- `update-task` - Could reference similar tasks for consistency
- `add-task` - Could use project context for better task generation

## Export Patterns

### **Context Gatherer Module**
```javascript
export { ContextGatherer };
```

### **Fuzzy Search Module**
```javascript
export { FuzzyTaskSearch };
```

This context gathering system provides a foundation for building more intelligent, context-aware commands that can leverage project knowledge to provide better AI-powered assistance.
