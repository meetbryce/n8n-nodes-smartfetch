# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-08

### Added

- Initial release of Smartfetch n8n community node
- HTTP GET requests with built-in response caching
- Two cache storage options:
  - **Memory**: Fast in-process cache (cleared on n8n restart, 1000 entry limit)
  - **PostgreSQL**: Persistent database cache for production use
- Authentication support:
  - Basic Auth
  - Bearer Token
  - Digest Auth
  - Header Auth
  - Query Parameter Auth
- Configurable cache duration (5 min, 1 hour, 1 day, 1 week, 1 month, or custom)
- Per-item error handling (one failed request doesn't fail the entire batch)
- Credential-aware cache keys (different credentials = different cache entries)
- Automatic cache expiration based on TTL
- SSL/TLS support for PostgreSQL with configurable verification modes
