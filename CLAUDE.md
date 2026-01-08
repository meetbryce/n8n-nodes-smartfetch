# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Smartfetch is an n8n community node that acts as a superset of the native HTTP Request node, adding a simple caching layer with intuitive controls. The goal is to make caching accessible to non-technical users without being overwhelming.

## Development Principles

- **Linting and tests must pass**: Work is not considered complete if `npm run lint` or `npm test` fail. Always verify both pass before finishing a task.
- **Don't break existing tests**: When working on any code, ensure existing tests continue to pass. Run tests frequently during development.
- **Separate application and test changes**: Never edit application code and test code at the same time. The user will specify which to work on. If asked to write a test, do not modify the application code without approval.

## Commands

```bash
npm run dev          # Start n8n with this node in dev mode (hot reload)
npm run build        # Compile TypeScript to dist/
npm run lint         # Lint code
npm run lint:fix     # Auto-fix lint issues
npm test             # Run test suite
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Architecture

This is an n8n community node using the **programmatic node pattern** (custom `execute()` method).

### Structure

```
nodes/Smartfetch/
  Smartfetch.node.ts              # Main node with execute() method
  Smartfetch.node.json            # Node metadata and documentation links
  Smartfetch.node.test.ts         # Integration tests
  cache/
    types.ts                      # CacheEntry, CacheAdapter interfaces, helpers
    memory.ts                     # In-memory cache adapter (1000 entry limit)
    postgres.ts                   # PostgreSQL cache adapter
    index.ts                      # Exports
    *.test.ts                     # Unit tests for adapters
```

### Key Patterns

**Programmatic execution**: Uses `execute()` method for custom cache logic instead of declarative routing.

**Cache adapters**: Pluggable storage backends implementing `CacheAdapter` interface:
```typescript
interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  close?(): Promise<void>;
}
```

**Built-in auth**: Uses n8n's credential system - supports Basic, Bearer, Digest, Header, and Query authentication.
