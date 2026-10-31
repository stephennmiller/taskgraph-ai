---
description: "TaskGraph: show or change the AI models TaskGraph uses for planning and research."
argument-hint: "[setup] [main|research|fallback] [opus|sonnet|haiku]"
---

Show the AI models TaskGraph uses, or change them. TaskGraph runs every model through Claude Code, so no API keys are needed; the models are `opus`, `sonnet` and `haiku`.

Usage: `/taskgraph:models` to see them, `/taskgraph:models setup` or `/taskgraph:models <role> <model>` to change them

Arguments: $ARGUMENTS

1. Run `taskgraph models` and show the output unchanged in a code block.
2. With no arguments, say in one sentence which model each role uses (main, research, fallback) and that `/taskgraph:models setup` changes them. Stop here.
3. With `setup`, or a role and a model: if the arguments don't already name a role and a model, ask the user which roles to change: main (generating and updating tasks), research (research-backed runs) and fallback (used when main fails). Then run one line per role that changes, with a model from the list above only:

   ```bash
   taskgraph models --set-main <model>
   taskgraph models --set-research <model>
   taskgraph models --set-fallback <model>
   ```

   `taskgraph models --setup` is an interactive menu for the user's own terminal; it can't be answered from here.
4. Show the output unchanged. The choice is saved in `.taskgraph/config.json`.
