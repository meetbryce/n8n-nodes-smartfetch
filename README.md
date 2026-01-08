# n8n-nodes-smartfetch

An n8n community node that provides HTTP GET requests with built-in caching. Think of it as a superset of the native HTTP Request node, but with simple cache controls that don't overwhelm non-technical users.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Features

- **HTTP GET with caching** - Automatically cache responses to reduce API calls
- **Flexible cache storage** - Memory (fast, ephemeral) or PostgreSQL (persistent)
- **Simple TTL controls** - Preset durations (5min, 1hr, 1day, 1week, 1month) or custom
- **Multiple auth methods** - Basic, Bearer, Digest, Header, and Query authentication
- **Secure cache keys** - Credentials are hashed (SHA-256) so different auth = different cache

## Cache Storage Options

### Memory
- Fast, in-process caching
- Cleared when n8n restarts
- Good for development or short-lived caches

### PostgreSQL
- Persistent caching across restarts
- Auto-creates cache table with schema:
  - `key` (VARCHAR) - hashed cache key
  - `request_url` (TEXT) - original URL for debugging
  - `response` (JSONB) - cached response data
  - `cached_at` (TIMESTAMPTZ) - when cached
  - `ttl` (INT) - time-to-live in seconds
- Configurable table name (multiple caches per database)
- SSL enabled by default

## Authentication

| Method | Description |
|--------|-------------|
| None | No authentication |
| Basic Auth | Username/password via Authorization header |
| Bearer Auth | Token via Authorization: Bearer header |
| Digest Auth | Challenge-response authentication |
| Header Auth | Custom header name/value |
| Query Auth | API key as query parameter |

## Compatibility

Tested with n8n version 2.2.4.

## Usage

1. Add the Smartfetch node to your workflow
2. Enter the URL to fetch
3. Select authentication method (if needed)
4. Choose cache storage (Memory or PostgreSQL)
5. Set cache duration
6. Execute!

Subsequent executions with the same URL and credentials will return cached responses until TTL expires.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
