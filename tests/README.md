# TaskGraph Test Suite

This directory contains tests for the TaskGraph CLI. The tests are organized into different categories to ensure comprehensive test coverage.

## Test Structure

- `unit/`: Unit tests for individual functions and components
- `integration/`: Integration tests for testing interactions between components
- `e2e/`: End-to-end tests for testing complete workflows
- `fixtures/`: Test fixtures and sample data

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

### Running under Vitest (Jest to Vitest migration, #71)

The root suite is being migrated from Jest to Vitest. During the migration both
runners work. Vitest uses `vitest.root.config.ts` (globals, node env,
`clearMocks`, `@/` alias, `tests/setup.js`; `.js` and `.ts` tests).

```bash
# Run a single file (or directory) under Vitest
npx vitest run -c vitest.root.config.ts tests/unit/task-manager/move-task.test.js

# Run the whole root suite under Vitest (temporary script)
npm run test:vitest
```

Files that still call `jest.*` APIs will fail under Vitest until migrated.

## Testing Approach

### Unit Tests

Unit tests focus on testing individual functions and components in isolation. These tests should be fast and should mock external dependencies.

### Integration Tests

Integration tests focus on testing interactions between components. These tests ensure that components work together correctly.

### End-to-End Tests

End-to-end tests focus on testing complete workflows from a user's perspective. These tests ensure that the CLI works correctly as a whole.

## Test Fixtures

Test fixtures provide sample data for tests. Fixtures should be small, focused, and representative of real-world data.

## Mocking

For external dependencies like file system operations and API calls, we use mocking to isolate the code being tested.

- File system operations: Use `mock-fs` to mock the file system
- API calls: Use Jest's mocking capabilities to mock API responses

## Test Coverage

We aim for at least 80% test coverage for all code paths. Coverage reports can be generated with:

```bash
npm run test:coverage
```
