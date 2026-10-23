---
description: "TaskGraph: choose the AI models TaskGraph uses for planning and research."
argument-hint: "[main|research|fallback] [opus|sonnet|haiku]"
---

Choose the AI models TaskGraph uses. TaskGraph runs them through Claude Code, so no API keys are needed; the models are `opus`, `sonnet` and `haiku`.

Arguments: $ARGUMENTS

1. Run `taskgraph models` and show the current choice.
2. If the arguments don't already name a role and a model, ask the user which roles to change: main (generating and updating tasks), research (`--research` runs) and fallback (used when main fails).
3. Run one line per role that changes, with a model from the list above only:

   ```bash
   taskgraph models --set-main <model>
   taskgraph models --set-research <model>
   taskgraph models --set-fallback <model>
   ```

   `taskgraph models --setup` is an interactive menu for the user's own terminal; it can't be answered from here.
4. Show the output unchanged. The choice is saved in `.taskgraph/config.json`.
