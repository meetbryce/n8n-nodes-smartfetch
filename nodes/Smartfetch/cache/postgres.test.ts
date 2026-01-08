import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PostgresCacheAdapter, type PostgresCredentials } from './postgres';
import type { CacheEntry } from './types';

// Track the mock client instances and constructor calls
let mockClientInstance: {
	connect: Mock;
	query: Mock;
	end: Mock;
};
let constructorCalls: unknown[][] = [];

// Mock the pg module with a class
vi.mock('pg', () => {
	return {
		Client: class MockClient {
			connect: Mock;
			query: Mock;
			end: Mock;

			constructor(...args: unknown[]) {
				constructorCalls.push(args);
				this.connect = vi.fn().mockResolvedValue(undefined);
				this.query = vi.fn().mockResolvedValue({ rows: [] });
				this.end = vi.fn().mockResolvedValue(undefined);
				// eslint-disable-next-line @typescript-eslint/no-this-alias
				mockClientInstance = this;
			}
		},
	};
});

describe('PostgresCacheAdapter', () => {
	let adapter: PostgresCacheAdapter;

	const credentials: PostgresCredentials = {
		host: 'localhost',
		port: 5432,
		database: 'testdb',
		user: 'testuser',
		password: 'testpass',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		constructorCalls = [];
		adapter = new PostgresCacheAdapter(credentials, 'test_cache');
	});

	function createEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
		return {
			key: 'test-key-hash',
			requestUrl: 'https://example.com/api',
			response: JSON.stringify({ data: 'test' }),
			cachedAt: Date.now(),
			ttl: 3600,
			...overrides,
		};
	}

	describe('constructor SSL configuration', () => {
		it('should disable SSL when ssl is "disable"', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: 'disable' }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: false });
		});

		it('should disable SSL when ssl is false', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: false }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: false });
		});

		it('should use rejectUnauthorized: false for "allow" mode', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: 'allow' }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: false } });
		});

		it('should use rejectUnauthorized: false for "require" mode', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: 'require' }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: false } });
		});

		it('should use rejectUnauthorized: true for "verify-ca" mode', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: 'verify-ca' }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: true } });
		});

		it('should use rejectUnauthorized: true for "verify-full" mode', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: 'verify-full' }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: true } });
		});

		it('should default to rejectUnauthorized: false when ssl is undefined', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: undefined }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: false } });
		});

		it('should default to rejectUnauthorized: false when ssl is true', () => {
			constructorCalls = [];
			new PostgresCacheAdapter({ ...credentials, ssl: true }, 'cache');
			expect(constructorCalls[0][0]).toMatchObject({ ssl: { rejectUnauthorized: false } });
		});
	});

	describe('initialization', () => {
		it('should connect and create table on first operation', async () => {
			mockClientInstance.query.mockResolvedValueOnce({ rows: [] }); // CREATE TABLE
			mockClientInstance.query.mockResolvedValueOnce({ rows: [] }); // SELECT

			await adapter.get('some-key');

			expect(mockClientInstance.connect).toHaveBeenCalledOnce();
			expect(mockClientInstance.query).toHaveBeenCalledWith(
				expect.stringContaining('CREATE TABLE IF NOT EXISTS'),
			);
		});

		it('should only initialize once across multiple operations', async () => {
			mockClientInstance.query.mockResolvedValue({ rows: [] });

			await adapter.get('key1');
			await adapter.get('key2');
			await adapter.get('key3');

			expect(mockClientInstance.connect).toHaveBeenCalledOnce();
		});
	});

	describe('get', () => {
		it('should return null when entry does not exist', async () => {
			mockClientInstance.query.mockResolvedValueOnce({ rows: [] }); // CREATE TABLE
			mockClientInstance.query.mockResolvedValueOnce({ rows: [] }); // SELECT - no results

			const result = await adapter.get('non-existent-key');
			expect(result).toBeNull();
		});

		it('should return cache entry when found', async () => {
			const cachedAt = new Date();
			mockClientInstance.query.mockResolvedValueOnce({ rows: [] }); // CREATE TABLE
			mockClientInstance.query.mockResolvedValueOnce({
				rows: [
					{
						key: 'test-key',
						request_url: 'https://example.com',
						response: { data: 'test' }, // JSONB is returned as object
						cached_at: cachedAt,
						ttl: 3600,
					},
				],
			});

			const result = await adapter.get('test-key');

			expect(result).toEqual({
				key: 'test-key',
				requestUrl: 'https://example.com',
				response: JSON.stringify({ data: 'test' }),
				cachedAt: cachedAt.getTime(),
				ttl: 3600,
			});
		});
	});

	describe('set', () => {
		it('should insert or update cache entry', async () => {
			mockClientInstance.query.mockResolvedValue({ rows: [] });

			const entry = createEntry();
			await adapter.set(entry);

			// Second query should be the INSERT/UPSERT
			const insertCall = mockClientInstance.query.mock.calls[1];
			expect(insertCall[0]).toContain('INSERT INTO');
			expect(insertCall[0]).toContain('ON CONFLICT');
			expect(insertCall[1]).toContain(entry.key);
			expect(insertCall[1]).toContain(entry.requestUrl);
		});
	});

	describe('delete', () => {
		it('should delete cache entry by key', async () => {
			mockClientInstance.query.mockResolvedValue({ rows: [] });

			await adapter.delete('key-to-delete');

			const deleteCall = mockClientInstance.query.mock.calls[1];
			expect(deleteCall[0]).toContain('DELETE FROM');
			expect(deleteCall[1]).toEqual(['key-to-delete']);
		});
	});

	describe('close', () => {
		it('should close the database connection', async () => {
			mockClientInstance.query.mockResolvedValue({ rows: [] });

			// Initialize first
			await adapter.get('some-key');

			await adapter.close();

			expect(mockClientInstance.end).toHaveBeenCalledOnce();
		});

		it('should not throw if called before initialization', async () => {
			await expect(adapter.close()).resolves.toBeUndefined();
		});
	});

	describe('table name escaping', () => {
		it('should properly escape table names', async () => {
			constructorCalls = [];
			const adapterWithSpecialName = new PostgresCacheAdapter(credentials, 'my_cache_table');
			mockClientInstance.query.mockResolvedValue({ rows: [] });

			await adapterWithSpecialName.get('key');

			expect(mockClientInstance.query).toHaveBeenCalledWith(
				expect.stringContaining('"my_cache_table"'),
			);
		});
	});
});
