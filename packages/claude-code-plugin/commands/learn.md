---
description: "TaskGraph: explain what TaskGraph can do. Use when the user asks how to use TaskGraph."
argument-hint: "[arguments]"
---

Learn about TaskGraph capabilities through interactive exploration.

Arguments: $ARGUMENTS

## Interactive TaskGraph Learning

Based on your input, I'll help you discover capabilities:

### 1. **What are you trying to do?**

If $ARGUMENTS contains:
- "start" / "begin" → Show project initialization workflows
- "manage" / "organize" → Show task management commands
- "automate" / "auto" → Show automation workflows
- "analyze" / "report" → Show analysis tools
- "fix" / "problem" → Show troubleshooting commands
- "fast" / "quick" → Show efficiency shortcuts

### 2. **Intelligent Suggestions**

Based on your project state:

**No tasks yet?**
```
You'll want to start with:
1. /taskgraph:init-project <prd-file>
   → Creates tasks from requirements

2. /taskgraph:parse-prd <file>
   → Alternative task generation

Try: /taskgraph:init-project demo-prd.md
```

**Have tasks?**
Let me analyze what you might need...
- Many pending tasks? → Learn sprint planning
- Complex tasks? → Learn task expansion
- Daily work? → Learn workflow automation

### 3. **Command Discovery**

**By Category:**
- 📋 Task Management: list, show, add, update, complete
- 🔄 Run an agent over the plan: `taskgraph loop` in a terminal
- 🛠️ Utilities: project-status, complexity-report, sync-readme
- 🔍 Analysis: validate-dependencies, graph

**By Scenario:**
- "I want to see what to work on" → `/taskgraph:next-task`
- "I need to break this down" → `/taskgraph:expand-task <id>`
- "Show me everything" → `/taskgraph:project-status`
- "Just do it for me" → `taskgraph loop` in a terminal (`--prompt tdd` for test-first)

### 4. **Power User Patterns**

**Command Chaining:**
```
/taskgraph:next-task
/taskgraph:to-in-progress <id>
```

**Smart Filters:**
```
/taskgraph:list-tasks pending high
/taskgraph:list-tasks blocked
/taskgraph:list-tasks 1-5 tree
```

**Automation:**
```
taskgraph loop -n 5
taskgraph loop --id 3 --prompt tdd
taskgraph loop --parallel 3
```

### 5. **Learning Path**

Based on your experience level:

**Beginner Path:**
1. init-project → Create project
2. project-status → Understand state
3. next-task → Find work
4. to-done → Finish task

**Intermediate Path:**
1. expand-task → Break down complex tasks
2. list-tasks pending → Organize work
3. complexity-report → Understand difficulty
4. validate-dependencies → Ensure consistency

**Advanced Path:**
1. `taskgraph loop` → Claude Code works the tasks, one per iteration
2. `taskgraph loop --parallel <n>` → Independent tasks side by side
3. Custom commands → Extend the system

### 6. **Try This Now**

Based on what you asked about, try:
[Specific command suggestion based on $ARGUMENTS]

Want to learn more about a specific command?
Type: /taskgraph:help <command-name>