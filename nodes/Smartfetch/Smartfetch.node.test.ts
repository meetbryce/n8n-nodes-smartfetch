import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Smartfetch } from './Smartfetch.node';
import type { IExecuteFunctions } from 'n8n-workflow';

// Configurable mock query responses
let mockQueryResponses: Array<{ rows: unknown[] }> = [];
let mockQueryIndex = 0;

// Track mock client instance
let mockClientInstance: {
	connect: Mock;
	query: Mock;
	end: Mock;
};

// Mock the pg module with a class
vi.mock('pg', () => {
	return {
		Client: class MockClient {
			connect: Mock;
			query: Mock;
			end: Mock;

			constructor() {
				this.connect = vi.fn().mockResolvedValue(undefined);
				this.query = vi.fn().mockImplementation(() => {
					if (mockQueryIndex < mockQueryResponses.length) {
						return Promise.resolve(mockQueryResponses[mockQueryIndex++]);
					}
					return Promise.resolve({ rows: [] });
				});
				this.end = vi.fn().mockResolvedValue(undefined);
				mockClientInstance = this;
			}
		},
	};
});

describe('Smartfetch Node', () => {
	let smartfetch: Smartfetch;
	let mockExecuteFunctions: IExecuteFunctions;

	beforeEach(() => {
		vi.clearAllMocks();
		mockQueryResponses = [];
		mockQueryIndex = 0;
		smartfetch = new Smartfetch();
	});

	function createMockExecuteFunctions(
		params: Record<string, unknown>,
		credentials: Record<string, Record<string, unknown>> = {},
		httpResponse: unknown = { success: true },
	): IExecuteFunctions {
		return {
			getInputData: vi.fn().mockReturnValue([{ json: {} }]),
			getNodeParameter: vi.fn().mockImplementation((name: string) => {
				return params[name];
			}),
			getCredentials: vi.fn().mockImplementation((type: string) => {
				return Promise.resolve(credentials[type] || {});
			}),
			getNode: vi.fn().mockReturnValue({ name: 'Smartfetch' }),
			helpers: {
				httpRequest: vi.fn().mockResolvedValue(httpResponse),
				httpRequestWithAuthentication: vi.fn().mockResolvedValue(httpResponse),
			},
		} as unknown as IExecuteFunctions;
	}

	describe('description', () => {
		it('should have correct node metadata', () => {
			expect(smartfetch.description.displayName).toBe('Smartfetch');
			expect(smartfetch.description.name).toBe('smartfetch');
			expect(smartfetch.description.usableAsTool).toBe(true);
		});

		it('should have cache storage options', () => {
			const cacheStorageProp = smartfetch.description.properties.find(
				(p) => p.name === 'cacheStorage',
			);
			expect(cacheStorageProp).toBeDefined();
			expect(cacheStorageProp?.type).toBe('options');
		});
	});

	describe('execute - memory cache', () => {
		it('should fetch URL and cache response in memory', async () => {
			const httpResponse = { data: 'test-response' };
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'none',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{},
				httpResponse,
			);

			const result = await smartfetch.execute.call(mockExecuteFunctions);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json).toEqual(httpResponse);
			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledWith({
				method: 'GET',
				url: 'https://httpbin.org/get',
				json: true,
			});
		});

		it('should return cached response on second call', async () => {
			const httpResponse = { data: 'cached-response' };
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get?cached=true',
					authentication: 'none',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{},
				httpResponse,
			);

			// First call - should hit the API
			await smartfetch.execute.call(mockExecuteFunctions);
			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledTimes(1);

			// Second call with same URL - should use cache
			const result = await smartfetch.execute.call(mockExecuteFunctions);
			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledTimes(1); // Still 1
			expect(result[0][0].json).toEqual(httpResponse);
		});
	});

	describe('execute - postgres cache', () => {
		it('should fetch URL and cache response in PostgreSQL', async () => {
			const httpResponse = { args: { olives: 'tasty' }, url: 'https://httpbin.org/get' };

			// Set up mock responses: CREATE TABLE, SELECT (miss), INSERT
			mockQueryResponses = [
				{ rows: [] }, // CREATE TABLE
				{ rows: [] }, // SELECT - cache miss
			];

			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get?olives=tasty',
					authentication: 'none',
					cacheStorage: 'postgres',
					cacheTableName: 'smartfetch_cache',
					cacheDuration: 300,
				},
				{
					postgres: {
						host: 'localhost',
						port: 5432,
						database: 'testdb',
						user: 'testuser',
						password: 'testpass',
						ssl: 'require',
					},
				},
				httpResponse,
			);

			const result = await smartfetch.execute.call(mockExecuteFunctions);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json).toEqual(httpResponse);

			// Verify PostgreSQL interactions
			expect(mockClientInstance.connect).toHaveBeenCalled();
			expect(mockClientInstance.query).toHaveBeenCalledWith(
				expect.stringContaining('CREATE TABLE IF NOT EXISTS'),
			);
			expect(mockClientInstance.query).toHaveBeenCalledWith(
				expect.stringContaining('INSERT INTO'),
				expect.any(Array),
			);
			expect(mockClientInstance.end).toHaveBeenCalled(); // Connection closed
		});

		it('should return cached response from PostgreSQL on cache hit', async () => {
			const cachedResponse = { args: { olives: 'tasty' }, cached: true };
			const cachedAt = new Date();

			// Set up mock responses: CREATE TABLE, SELECT (hit with data)
			mockQueryResponses = [
				{ rows: [] }, // CREATE TABLE
				{
					rows: [
						{
							key: 'some-hash',
							request_url: 'https://httpbin.org/get?olives=tasty&cached=hit',
							response: cachedResponse, // JSONB returned as object
							cached_at: cachedAt,
							ttl: 300,
						},
					],
				}, // SELECT - cache hit
			];

			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get?olives=tasty&cached=hit',
					authentication: 'none',
					cacheStorage: 'postgres',
					cacheTableName: 'smartfetch_cache',
					cacheDuration: 300,
				},
				{
					postgres: {
						host: 'localhost',
						port: 5432,
						database: 'testdb',
						user: 'testuser',
						password: 'testpass',
					},
				},
			);

			const result = await smartfetch.execute.call(mockExecuteFunctions);

			// Should return cached response, not make HTTP request
			expect(result[0][0].json).toEqual(cachedResponse);
			expect(mockExecuteFunctions.helpers.httpRequest).not.toHaveBeenCalled();
		});

		it('should always close PostgreSQL connection (even on error)', async () => {
			// Set up mock responses
			mockQueryResponses = [
				{ rows: [] }, // CREATE TABLE
				{ rows: [] }, // SELECT - cache miss
			];

			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'none',
					cacheStorage: 'postgres',
					cacheTableName: 'smartfetch_cache',
					cacheDuration: 300,
				},
				{
					postgres: {
						host: 'localhost',
						port: 5432,
						database: 'testdb',
						user: 'testuser',
						password: 'testpass',
					},
				},
			);

			// Make HTTP request throw an error
			(mockExecuteFunctions.helpers.httpRequest as Mock).mockRejectedValue(
				new Error('Network error'),
			);

			// Execute should not throw (per-item error handling)
			const result = await smartfetch.execute.call(mockExecuteFunctions);

			// Error should be captured in the output
			expect(result[0][0].json).toMatchObject({
				error: true,
				message: 'Network error',
			});

			// Connection should still be closed
			expect(mockClientInstance.end).toHaveBeenCalled();
		});
	});

	describe('execute - authentication', () => {
		it('should add Basic Auth header', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'httpBasicAuth',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{
					httpBasicAuth: {
						user: 'testuser',
						password: 'testpass',
					},
				},
			);

			await smartfetch.execute.call(mockExecuteFunctions);

			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: {
						Authorization: `Basic ${Buffer.from('testuser:testpass').toString('base64')}`,
					},
				}),
			);
		});

		it('should add Bearer Auth header', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'httpBearerAuth',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{
					httpBearerAuth: {
						token: 'my-secret-token',
					},
				},
			);

			await smartfetch.execute.call(mockExecuteFunctions);

			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: {
						Authorization: 'Bearer my-secret-token',
					},
				}),
			);
		});

		it('should append query auth to URL', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'httpQueryAuth',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{
					httpQueryAuth: {
						name: 'api_key',
						value: 'secret123',
					},
				},
			);

			await smartfetch.execute.call(mockExecuteFunctions);

			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://httpbin.org/get?api_key=secret123',
				}),
			);
		});

		it('should use Digest Auth with sendImmediately false', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/digest-auth/auth/admin/hunter123',
					authentication: 'httpDigestAuth',
					cacheStorage: 'memory',
					cacheDuration: 300,
				},
				{
					httpDigestAuth: {
						user: 'admin',
						password: 'hunter123',
					},
				},
			);

			await smartfetch.execute.call(mockExecuteFunctions);

			expect(mockExecuteFunctions.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					url: 'https://httpbin.org/digest-auth/auth/admin/hunter123',
					auth: {
						username: 'admin',
						password: 'hunter123',
						sendImmediately: false,
					},
				}),
			);
		});
	});

	describe('execute - validation', () => {
		it('should reject invalid table names', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'none',
					cacheStorage: 'postgres',
					cacheTableName: 'invalid-table-name!', // Invalid characters
					cacheDuration: 300,
				},
				{
					postgres: {
						host: 'localhost',
						port: 5432,
						database: 'testdb',
						user: 'testuser',
						password: 'testpass',
					},
				},
			);

			await expect(smartfetch.execute.call(mockExecuteFunctions)).rejects.toThrow(
				/table name must start with/i,
			);
		});

		it('should reject custom TTL exceeding maximum', async () => {
			mockExecuteFunctions = createMockExecuteFunctions(
				{
					url: 'https://httpbin.org/get',
					authentication: 'none',
					cacheStorage: 'memory',
					cacheDuration: 'custom',
					customTtl: 999999999, // Way over 1 year limit
				},
			);

			await expect(smartfetch.execute.call(mockExecuteFunctions)).rejects.toThrow(
				/Custom TTL must be/i,
			);
		});
	});

	describe('execute - multiple items', () => {
		it('should process multiple input items', async () => {
			mockExecuteFunctions = {
				...createMockExecuteFunctions(
					{
						url: 'https://httpbin.org/get',
						authentication: 'none',
						cacheStorage: 'memory',
						cacheDuration: 300,
					},
					{},
					{ success: true },
				),
				getInputData: vi.fn().mockReturnValue([{ json: { id: 1 } }, { json: { id: 2 } }]),
			} as unknown as IExecuteFunctions;

			const result = await smartfetch.execute.call(mockExecuteFunctions);

			expect(result[0]).toHaveLength(2);
			expect(result[0][0].pairedItem).toEqual({ item: 0 });
			expect(result[0][1].pairedItem).toEqual({ item: 1 });
		});
	});
});
