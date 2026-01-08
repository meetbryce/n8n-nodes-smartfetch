export interface CacheEntry {
	key: string;
	requestUrl: string;
	response: string;
	cachedAt: number;
	ttl: number;
}

export interface CacheAdapter {
	get(key: string): Promise<CacheEntry | null>;
	set(entry: CacheEntry): Promise<void>;
}

export function isCacheValid(entry: CacheEntry): boolean {
	const now = Date.now();
	const expiresAt = entry.cachedAt + entry.ttl * 1000;
	return now < expiresAt;
}

export function generateCacheKey(url: string, credentialType?: string): string {
	const base = credentialType ? `${credentialType}:${url}` : url;
	// Simple hash for cache key
	let hash = 0;
	for (let i = 0; i < base.length; i++) {
		const char = base.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(36);
}
