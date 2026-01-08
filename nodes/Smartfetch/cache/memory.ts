import type { CacheAdapter, CacheEntry } from './types';
import { isCacheValid } from './types';

const MAX_CACHE_ENTRIES = 1000;

/**
 * Global in-memory cache shared across all workflow executions.
 * Note: This cache persists for the lifetime of the n8n process and is
 * shared across all workflows and users. Cache entries are isolated by
 * their cache keys (which include URL and credential hashes).
 */
const memoryCache = new Map<string, CacheEntry>();

export class MemoryCacheAdapter implements CacheAdapter {
	async get(key: string): Promise<CacheEntry | null> {
		const entry = memoryCache.get(key);
		if (!entry) return null;

		// Lazy cleanup: delete expired entries on access
		if (!isCacheValid(entry)) {
			memoryCache.delete(key);
			return null;
		}
		return entry;
	}

	async set(entry: CacheEntry): Promise<void> {
		// Prune expired entries first
		this.pruneExpired();

		// If still over limit, remove oldest entries (FIFO eviction)
		while (memoryCache.size >= MAX_CACHE_ENTRIES) {
			const firstKey = memoryCache.keys().next().value;
			if (firstKey !== undefined) {
				memoryCache.delete(firstKey);
			} else {
				break; // Safety: shouldn't happen, but prevent infinite loop
			}
		}

		memoryCache.set(entry.key, entry);
	}

	async delete(key: string): Promise<void> {
		memoryCache.delete(key);
	}

	async close(): Promise<void> {
		// No-op for memory adapter, but included for interface consistency
	}

	private pruneExpired(): void {
		for (const [key, entry] of memoryCache) {
			if (!isCacheValid(entry)) {
				memoryCache.delete(key);
			}
		}
	}
}
