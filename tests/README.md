# TaskGraph Test Suite

This directory holds the root test suite: repo-level checks such as the git hooks, CI scripts and plugin hooks. Feature tests live next to the code in `packages/` and `apps/` (see "Test Guidelines" in CLAUDE.md and `.claude/rules/tests.md`).

## Test Structure

- `unit/`: Unit tests for individual functions and components
- `integration/`: Integration tests for testing interactions between components
- `manual/`: Scripts run by hand, such as the prompt test harness

## Running Tests

To run all tests:

```bash
npm test
```

To run tests in watch mode (for development):

```bash
npm run test:watch
```

To run tests with coverage reporting:

```bash
npm run test:coverage
```

### Vitest configuration

The root suite runs on Vitest with `vitest.root.config.ts` (globals, node env,
`clearMocks`, `@/` alias, `tests/setup.js`; `.js` and `.ts` tests). Coverage is
off by default and enabled by `npm run test:coverage` (reports in `coverage/`).

```bash
# Run a single file (or directory)
npx vitest run -c vitest.root.config.ts tests/unit/githooks/check-file-size.test.ts

# Run unit or integration tests only (path filter)
npm run test:unit
npm run test:integration
```

## Testing Approach

### Unit Tests

Unit tests focus on testing individual functions and components in isolation. These tests should be fast and should mock external dependencies.

### Integration Tests

Integration tests focus on testing interactions between components. These tests ensure that components work together correctly.

## Mocking

For external dependencies like file system operations and API calls, we use mocking to isolate the code being tested.

- File system operations: use a temporary directory (`fs.mkdtempSync`) or `vi.mock` the `fs` calls
- API calls: Use Vitest's mocking capabilities (`vi.fn`, `vi.mock`) to mock API responses

## Test Coverage

We aim for at least 80% test coverage for all code paths. Coverage reports can be generated with:

```bash
npm run test:coverage
```
