---
description: "TaskGraph: run the workflow that fits the plan's current state."
argument-hint: "[arguments]"
---

Execute an intelligent workflow based on current project state and recent commands.

This command analyzes:
1. Recent commands you've run
2. Current project state
3. Time of day / day of week
4. Your working patterns

Arguments: $ARGUMENTS

## Intelligent Workflow Selection

Based on context, I'll determine the best workflow:

### Context Analysis
- Previous command executed
- Current task states
- Unfinished work from last session
- Your typical patterns

### Smart Execution

If last command was:
- `project-status` → Likely starting work → Show what is in progress and next
- `to-done` → Task finished → Find next task
- `list-tasks pending` → Planning → Suggest an order to work in
- `expand-task` → Breaking down work → Show complexity analysis
- `init-project` → New project → Show onboarding workflow

If no recent commands:
- Morning? → Project status, then the next task
- Many pending tasks? → Suggest an order to work in
- Tasks blocked? → Dependency resolution
- Friday? → Weekly review

### Workflow Composition

I'll chain appropriate commands:
1. Analyze current state
2. Execute primary workflow
3. Suggest follow-up actions
4. Prepare environment for coding

### Learning Mode

This command learns from your patterns:
- Track command sequences
- Note time preferences
- Remember common workflows
- Adapt to your style

Example flows detected:
- Morning: project-status → next-task → to-in-progress
- After lunch: project-status → continue task
- End of day: to-done → commit → project-status