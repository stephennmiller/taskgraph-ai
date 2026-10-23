---
description: "TaskGraph: add a subtask to a task. Use when a TaskGraph task needs a smaller step."
argument-hint: "[arguments]"
---

Add a subtask to a parent task.

Arguments: $ARGUMENTS

Parse arguments to create a new subtask or convert existing task.

## Adding Subtasks

Creates subtasks to break down complex parent tasks into manageable pieces.

## Argument Parsing

Flexible natural language:
- "add subtask to 5: implement login form"
- "break down 5 with: setup, implement, test"
- "subtask for 5: handle edge cases"
- "5: validate user input" → adds subtask to task 5

## Execution Modes

### 1. Create New Subtask
```bash
taskgraph add-subtask --parent=<id> --title='<title>' --description='<desc>'
```

Keep the title and description in single quotes, and write any `'` inside them as `'\''`. In double quotes the shell would run backticks and `$(...)` in the text.

### 2. Convert Existing Task
```bash
taskgraph add-subtask --parent=<id> --task-id=<existing-id>
```

Put each ID into the command only when it is digits and dots (`5`, `5.2`); otherwise ask the user for the task ID.

## Smart Features

1. **Automatic Subtask Generation**
   - If title contains "and" or commas, create multiple
   - Suggest common subtask patterns
   - Inherit parent's context

2. **Intelligent Defaults**
   - Priority based on parent
   - Appropriate time estimates
   - Logical dependencies between subtasks

3. **Validation**
   - Check parent task complexity
   - Warn if too many subtasks
   - Ensure subtask makes sense

## Creation Process

1. Parse parent task context
2. Generate subtask with ID like "5.1"
3. Set appropriate defaults
4. Link to parent task
5. Update parent's time estimate

## Example Flows

```
/taskgraph:add-subtask to 5: implement user authentication
→ Created subtask #5.1: "implement user authentication"
→ Parent task #5 now has 1 subtask
→ Suggested next subtasks: tests, documentation

/taskgraph:add-subtask 5: setup, implement, test
→ Created 3 subtasks:
  #5.1: setup
  #5.2: implement  
  #5.3: test
```

## Post-Creation

- Show updated task hierarchy
- Suggest logical next subtasks
- Update complexity estimates
- Recommend subtask order