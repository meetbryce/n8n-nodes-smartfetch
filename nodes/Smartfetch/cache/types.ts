import { createHash } from 'crypto';

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
	delete(key: string): Promise<void>;
	close?(): Promise<void>;
}

export function isCacheValid(entry: CacheEntry): boolean {
	const now = Date.now();
	// Cap TTL to prevent overflow with extreme values (max ~24 days in ms fits safely)
	const safeTtlMs = Math.min(entry.ttl * 1000, 2147483647);
	const expiresAt = entry.cachedAt + safeTtlMs;
	return now < expiresAt;
}

/**
 * Generate a cryptographically secure cache key using SHA-256.
 * The key incorporates the URL and optional credential hash to ensure
 * different credentials result in different cache entries.
 */
export function generateCacheKey(url: string, credentialHash?: string): string {
	const base = credentialHash ? `${credentialHash}:${url}` : url;
	return createHash('sha256').update(base).digest('hex');
}
