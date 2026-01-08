import type { CacheAdapter, CacheEntry } from './types';

const memoryCache = new Map<string, CacheEntry>();

export class MemoryCacheAdapter implements CacheAdapter {
	async get(key: string): Promise<CacheEntry | null> {
		return memoryCache.get(key) ?? null;
	}

	async set(entry: CacheEntry): Promise<void> {
		memoryCache.set(entry.key, entry);
	}
}
