# @tm/core

All of TaskGraph's business logic: tasks, dependencies, tags, config, git, GitHub sync and the loop. The CLI (`apps/cli`) and the MCP server (`apps/mcp`) are thin layers over it, and the legacy JS in `scripts/` calls into it too.

`@tm/core` is a private workspace package. It isn't published to npm; other workspaces depend on it by name. It is ESM only and ships its TypeScript source (`exports` points at `src/`), which the root `tsdown` build bundles into the CLI.

## Entry points

- `@tm/core`: the public API. Import everything from here.
- `@tm/core/testing`: test fixtures (`createTask`, `createSubtask`, `createTasksFile`, `TaskScenarios`, `MetadataFixtures`) and `createMockLogger`.

## Usage

`createTmCore` is the way in. It loads the project's config and returns a `TmCore` whose domains do the work. `projectPath` must be absolute.

```typescript
import { createTmCore } from '@tm/core';

const tmCore = await createTmCore({ projectPath: process.cwd() });

const { tasks } = await tmCore.tasks.list();
const next = await tmCore.tasks.getNext();
const { task, isSubtask } = await tmCore.tasks.get('3.2'); // task or subtask ID
await tmCore.tasks.updateStatus('3.2', 'in-progress');

await tmCore.close(); // releases file locks
```

| Domain | What it does |
| --- | --- |
| `tmCore.tasks` | Read and change tasks: `list`, `get`, `getNext`, `claimNext`, `update`, `updateStatus`, `addNote`, checklists, archive, tags, dependency trees and blockers |
| `tmCore.config` | Project config: `getConfig`, `getModelConfig`, `getActiveTag`, `setActiveTag`, `updateConfig` |
| `tmCore.git` | Repository state, branches, staging and commits (`createCommit`, `generateCommitMessage`) |
| `tmCore.github` | Sync with GitHub Issues: `status`, `planPush`/`push`, `planPull`/`pull`, `unlink` |
| `tmCore.loop` | Run Claude Code over tasks one at a time (`run`) or in parallel worktrees (`runParallel`) |
| `tmCore.logger` | The logger. Pass `loggerConfig` to `createTmCore` to route it; the MCP server sends it to the MCP log |

`@tm/core` also exports the types, Zod schemas, errors (`TaskGraphError`, `ERROR_CODES`) and pure helpers the CLI and MCP share, such as `selectNextTask`, `buildPrimeContext` and the dependency and PRD utilities. See `src/index.ts` for the full list.

## Layout

```
src/
  tm-core.ts   TmCore facade and createTmCore
  index.ts     public exports
  common/      types, interfaces, schemas, constants, errors, logger, utils
  modules/     one folder per area: tasks, config, git, github, loop,
               storage, dependencies, prd, reports, migration
  testing/     @tm/core/testing
  utils/       time helpers
tests/         integration tests (*.test.ts); unit tests sit next to the source
```

## Scripts

Run them from the repo root with `-w @tm/core`, for example `npm run test -w @tm/core`.

| Script | What it runs |
| --- | --- |
| `test` | All tests (`vitest run`) |
| `test:unit` | Unit tests only (`*.spec.ts`) |
| `test:integration` | Integration tests only (`*.test.ts`) |
| `test:watch` | Vitest in watch mode |
| `test:coverage` | Tests with coverage |
| `typecheck` | `tsc --noEmit` |
| `lint` / `lint:check` / `lint:fix` | Biome check: write fixes / read only / also apply unsafe fixes |
| `format` / `format:check` | Biome format: write / read only |

The package has no build script: `npm run build` at the root builds the CLI, `@tm/core` included.

## License

See the repository's [LICENSE](../../LICENSE).
