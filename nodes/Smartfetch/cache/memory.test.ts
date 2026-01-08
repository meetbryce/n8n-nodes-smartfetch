import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCacheAdapter } from './memory';
import type { CacheEntry } from './types';

describe('MemoryCacheAdapter', () => {
	let adapter: MemoryCacheAdapter;

	beforeEach(() => {
		adapter = new MemoryCacheAdapter();
	});

	function createEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
		return {
			key: 'test-key',
			requestUrl: 'https://example.com/api',
			response: JSON.stringify({ data: 'test' }),
			cachedAt: Date.now(),
			ttl: 3600, // 1 hour
			...overrides,
		};
	}

	describe('set and get', () => {
		it('should store and retrieve a cache entry', async () => {
			const entry = createEntry();
			await adapter.set(entry);

			const retrieved = await adapter.get(entry.key);
			expect(retrieved).toEqual(entry);
		});

		it('should return null for non-existent keys', async () => {
			const result = await adapter.get('non-existent-key');
			expect(result).toBeNull();
		});

		it('should overwrite existing entries with same key', async () => {
			const entry1 = createEntry({ response: JSON.stringify({ version: 1 }) });
			const entry2 = createEntry({ response: JSON.stringify({ version: 2 }) });

			await adapter.set(entry1);
			await adapter.set(entry2);

			const retrieved = await adapter.get(entry1.key);
			expect(retrieved?.response).toBe(entry2.response);
		});
	});

	describe('expiration', () => {
		it('should return null for expired entries', async () => {
			const entry = createEntry({
				cachedAt: Date.now() - 7200 * 1000, // 2 hours ago
				ttl: 3600, // 1 hour TTL - already expired
			});
			await adapter.set(entry);

			const retrieved = await adapter.get(entry.key);
			expect(retrieved).toBeNull();
		});

		it('should return valid entries that are not yet expired', async () => {
			const entry = createEntry({
				cachedAt: Date.now() - 1800 * 1000, // 30 minutes ago
				ttl: 3600, // 1 hour TTL - still valid
			});
			await adapter.set(entry);

			const retrieved = await adapter.get(entry.key);
			expect(retrieved).toEqual(entry);
		});
	});

	describe('delete', () => {
		it('should delete an existing entry', async () => {
			const entry = createEntry();
			await adapter.set(entry);
			await adapter.delete(entry.key);

			const retrieved = await adapter.get(entry.key);
			expect(retrieved).toBeNull();
		});

		it('should not throw when deleting non-existent key', async () => {
			await expect(adapter.delete('non-existent-key')).resolves.toBeUndefined();
		});
	});

	describe('close', () => {
		it('should be a no-op and not throw', async () => {
			await expect(adapter.close()).resolves.toBeUndefined();
		});
	});

	describe('cache limits', () => {
		it('should enforce maximum cache entries (FIFO eviction)', async () => {
			// Create 1001 entries (exceeds MAX_CACHE_ENTRIES of 1000)
			for (let i = 0; i < 1001; i++) {
				await adapter.set(createEntry({ key: `key-${i}` }));
			}

			// First entry should have been evicted
			const first = await adapter.get('key-0');
			expect(first).toBeNull();

			// Last entry should still exist
			const last = await adapter.get('key-1000');
			expect(last).not.toBeNull();
		});
	});
});
