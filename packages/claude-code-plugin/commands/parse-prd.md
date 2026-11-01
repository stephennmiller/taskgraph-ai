---
description: "TaskGraph: turn a PRD or spec into tasks, asking about gaps first. Use when the user has a requirements doc."
argument-hint: "[PRD file path] [number of tasks] [research]"
---

Generate tasks from a PRD, after asking the user about the gaps that would change them.

Arguments: $ARGUMENTS (PRD file path, then optional modifiers). In the commands below, put the file path in single quotes and write any `'` in it as `'\''`. Modifiers:

- a number → `--num-tasks=<n>`
- `research` → `--research`, for a PRD with unfamiliar tech: the research model runs Claude Code with web search and fetch on the tech the PRD names

## 1. Find the gaps

```bash
taskgraph parse-prd '<prd-file>' --clarify --json
```

This reads the PRD and prints only JSON, at most five questions, each with the answer the model would assume:

```json
{
  "schemaVersion": 3,
  "prd": "prd.md",
  "questions": [
    { "question": "Which database should the app use?", "suggestedAnswer": "PostgreSQL 16" }
  ]
}
```

It changes nothing. If `questions` is empty, the PRD is clear enough: go to step 4.

## 2. Ask the user

Ask the questions in the conversation, all in one message, numbered, each with its suggested answer. Tell the user they can reply with just the numbers they want to change, and that the rest keep the suggestion. Don't answer for the user, and don't drop a question.

## 3. Save the answers and generate the tasks

Write the JSON from step 1, with an `answer` added to each question the user answered, to `.taskgraph/clarify-answers.json` with the Write tool. A question with no `answer` keeps its `suggestedAnswer`. Don't put the answers in a shell command (no `echo`, no heredoc): the user's words could end the heredoc or run as commands. Keep each answer on one line.

```json
{
  "questions": [
    { "question": "Which database should the app use?", "suggestedAnswer": "PostgreSQL 16", "answer": "SQLite" }
  ]
}
```

Then pass the file, and remove it once the tasks are generated:

```bash
taskgraph parse-prd '<prd-file>' --answers .taskgraph/clarify-answers.json
rm .taskgraph/clarify-answers.json
```

The answers are written into the PRD under `## Clarifications` (an answer already there is replaced, not repeated), and the tasks are generated from the updated PRD, so the decisions stay in the repo. Add `--num-tasks=<n>` or `--research` from the arguments.

If the project already has tasks in the current tag, ask the user first whether to add to them (`--append`) or replace them (`--force`), and add that flag.

## 4. Without questions

```bash
taskgraph parse-prd '<prd-file>'
```

Same flags as step 3, without `--answers`.

## Acceptance criteria

Each generated task comes with 2-5 acceptance criteria, all unchecked. `taskgraph show <id>` numbers them, and `set-status done` refuses the task until every one is checked off with `taskgraph set-status --id=<id> --check <n>` (or `/taskgraph:to-done <id>`, which checks them against your changes first). Read them when you start a task: they say what "done" means.

## After

Show the user the task lines `parse-prd` printed, then suggest the next step:

```bash
taskgraph next
```

For large tasks, `/taskgraph:expand <id>` splits one into subtasks; `/taskgraph:analyze-complexity` finds which ones need it.
