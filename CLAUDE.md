# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Smartfetch is an n8n community node that acts as a superset of the native HTTP Request node, adding a simple caching layer with intuitive controls. The goal is to make caching accessible to non-technical users without being overwhelming.

## Development Principles
- Never edit application code and test code at the same time. The user should make clear to you which you are working on and you should only work on the one they specified. If asked to write a test, do not modify the application code without approval.

## Commands

```bash
npm run dev          # Start n8n with this node in dev mode (hot reload)
npm run build        # Compile TypeScript to dist/
npm run lint         # Lint code
npm run lint:fix     # Auto-fix lint issues
```

## Architecture

This is an n8n community node using the **programmatic node pattern** (custom `execute()` method).

### Structure

```
nodes/Smartfetch/
  Smartfetch.node.ts              # Main node with execute() method
  cache/
    types.ts                      # CacheEntry interface, helpers
    memory.ts                     # In-memory cache adapter
    datatable.ts                  # n8n DataTable cache adapter
    index.ts                      # Exports
```

### Key Patterns

**Programmatic execution**: Uses `execute()` method for custom cache logic instead of declarative routing.

**Cache adapters**: Pluggable storage backends implementing `CacheAdapter` interface:
```typescript
interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
}
```

**n8n DataTable API**: Access via `this.helpers.getDataTableProxy(tableId)` for persistent caching.

**Built-in auth**: Uses n8n's credential system via `httpRequestWithAuthentication()` - supports Basic, Header, Query, OAuth1, OAuth2.

**Resource locator**: Cache table selection uses `resourceLocator` type with `loadOptions.getDataTables()` method.
