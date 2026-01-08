import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { createHash } from 'crypto';
import {
	type CacheAdapter,
	generateCacheKey,
	isCacheValid,
	MemoryCacheAdapter,
	PostgresCacheAdapter,
	type PostgresCredentials,
} from './cache';

export class Smartfetch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smartfetch',
		name: 'smartfetch',
		icon: { light: 'file:smartfetch.svg', dark: 'file:smartfetch.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: 'GET with caching',
		description: 'HTTP GET request with built-in caching',
		defaults: {
			name: 'Smartfetch',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		/* eslint-disable n8n-nodes-base/node-class-description-credentials-name-unsuffixed, @n8n/community-nodes/no-credential-reuse */
		credentials: [
			{
				name: 'httpBasicAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpBasicAuth'] } },
			},
			{
				name: 'httpBearerAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpBearerAuth'] } },
			},
			{
				name: 'httpDigestAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpDigestAuth'] } },
			},
			{
				name: 'httpHeaderAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpHeaderAuth'] } },
			},
			{
				name: 'httpQueryAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpQueryAuth'] } },
			},
			{
				name: 'postgres',
				required: true,
				displayOptions: { show: { cacheStorage: ['postgres'] } },
			},
		],
		/* eslint-enable n8n-nodes-base/node-class-description-credentials-name-unsuffixed, @n8n/community-nodes/no-credential-reuse */
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://api.example.com/data',
				description: 'The URL to fetch',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'Basic Auth', value: 'httpBasicAuth' },
					{ name: 'Bearer Auth', value: 'httpBearerAuth' },
					{ name: 'Digest Auth', value: 'httpDigestAuth' },
					{ name: 'Header Auth', value: 'httpHeaderAuth' },
					{ name: 'None', value: 'none' },
					{ name: 'Query Auth', value: 'httpQueryAuth' },
				],
				default: 'none',
				description: 'The authentication method to use',
			},
			{
				displayName: 'Cache Storage',
				name: 'cacheStorage',
				type: 'options',
				options: [
					{
						name: 'Memory',
						value: 'memory',
						description: 'Fast, but cleared when n8n restarts',
					},
					{
						name: 'PostgreSQL',
						value: 'postgres',
						description: 'Persistent cache in PostgreSQL database',
					},
				],
				default: 'memory',
				description: 'Where to store cached responses',
			},
			{
				displayName: 'Cache Table Name',
				name: 'cacheTableName',
				type: 'string',
				default: 'smartfetch_cache',
				placeholder: 'e.g. smartfetch_cache',
				displayOptions: {
					show: {
						cacheStorage: ['postgres'],
					},
				},
				required: true,
				description: 'PostgreSQL table name for cache (will be created if it does not exist)',
			},
			{
				displayName: 'Cache Duration',
				name: 'cacheDuration',
				type: 'options',
				options: [
					{ name: '5 Minutes', value: 300 },
					{ name: '1 Hour', value: 3600 },
					{ name: '1 Day', value: 86400 },
					{ name: '1 Week', value: 604800 },
					{ name: '1 Month', value: 2592000 },
					{ name: 'Custom', value: 'custom' },
				],
				default: 3600,
				description: 'How long to cache responses',
			},
			{
				displayName: 'Custom TTL (Seconds)',
				name: 'customTtl',
				type: 'number',
				default: 3600,
				displayOptions: {
					show: {
						cacheDuration: ['custom'],
					},
				},
				description: 'Custom cache duration in seconds',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Create cache adapter ONCE for all items
		let cacheAdapter: CacheAdapter;
		let postgresAdapter: PostgresCacheAdapter | null = null;

		const cacheStorage = this.getNodeParameter('cacheStorage', 0) as string;
		if (cacheStorage === 'postgres') {
			const credentials = (await this.getCredentials('postgres')) as PostgresCredentials;
			const tableName = this.getNodeParameter('cacheTableName', 0) as string;

			// Validate table name: must start with letter/underscore, contain only alphanumeric/underscore, max 63 chars
			if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
				throw new NodeOperationError(this.getNode(), 'Cache table name must start with a letter or underscore and contain only alphanumeric characters and underscores');
			}
			if (tableName.length > 63) {
				throw new NodeOperationError(this.getNode(), 'Cache table name must be 63 characters or less (PostgreSQL identifier limit)');
			}

			postgresAdapter = new PostgresCacheAdapter(credentials, tableName);
			cacheAdapter = postgresAdapter;
		} else {
			cacheAdapter = new MemoryCacheAdapter();
		}

		try {
			for (let i = 0; i < items.length; i++) {
				const url = this.getNodeParameter('url', i) as string;
				const authentication = this.getNodeParameter('authentication', i) as string;
				const cacheDuration = this.getNodeParameter('cacheDuration', i) as number | string;
				let ttl: number;
				if (cacheDuration === 'custom') {
					ttl = this.getNodeParameter('customTtl', i) as number;
					// Validate custom TTL: must be positive integer, max 1 year
					if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 31536000) {
						throw new NodeOperationError(this.getNode(), 'Custom TTL must be a positive number between 1 and 31536000 seconds (1 year)', { itemIndex: i });
					}
				} else {
					ttl = cacheDuration as number;
				}

				// Generate cache key (include full SHA-256 hashed credentials for security)
				let credentialHash: string | undefined;
				if (authentication !== 'none') {
					const credentials = await this.getCredentials(authentication);
					const credentialString = JSON.stringify(credentials);
					credentialHash = createHash('sha256').update(credentialString).digest('hex');
				}
				const cacheKey = generateCacheKey(url, credentialHash);

				// Check cache
				const cachedEntry = await cacheAdapter.get(cacheKey);
				if (cachedEntry && isCacheValid(cachedEntry)) {
					try {
						returnData.push({
							json: JSON.parse(cachedEntry.response) as IDataObject,
							pairedItem: { item: i },
						});
						continue;
					} catch {
						// Cache entry corrupted - delete it and fall through to fetch fresh data
						try {
							await cacheAdapter.delete(cacheKey);
						} catch {
							// Ignore delete errors - we'll overwrite with fresh data anyway
						}
						// Intentional fall-through: proceed to HTTP request below
					}
				}

				// Make request with per-item error handling
				try {
					let response: IDataObject;
					const requestOptions: {
						method: 'GET';
						url: string;
						json: boolean;
						headers?: IDataObject;
					} = {
						method: 'GET',
						url,
						json: true,
					};

					if (authentication === 'none') {
						response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
					} else if (authentication === 'httpBasicAuth') {
						const credentials = await this.getCredentials('httpBasicAuth');
						const basicAuth = Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64');
						requestOptions.headers = {
							Authorization: `Basic ${basicAuth}`,
						};
						response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
					} else if (authentication === 'httpBearerAuth') {
						const credentials = await this.getCredentials('httpBearerAuth');
						requestOptions.headers = {
							Authorization: `Bearer ${credentials.token}`,
						};
						response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
					} else if (authentication === 'httpDigestAuth') {
						const credentials = await this.getCredentials('httpDigestAuth');
						response = (await this.helpers.httpRequest({
							...requestOptions,
							auth: {
								username: credentials.user as string,
								password: credentials.password as string,
								sendImmediately: false,
							},
						})) as IDataObject;
					} else if (authentication === 'httpQueryAuth') {
						const credentials = await this.getCredentials('httpQueryAuth');
						const separator = requestOptions.url.includes('?') ? '&' : '?';
						const encodedName = encodeURIComponent(credentials.name as string);
						const encodedValue = encodeURIComponent(credentials.value as string);
						requestOptions.url = `${requestOptions.url}${separator}${encodedName}=${encodedValue}`;
						response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
					} else {
						response = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							authentication,
							requestOptions,
						)) as IDataObject;
					}

					// Store in cache
					await cacheAdapter.set({
						key: cacheKey,
						requestUrl: url,
						response: JSON.stringify(response),
						cachedAt: Date.now(),
						ttl,
					});

					returnData.push({
						json: response,
						pairedItem: { item: i },
					});
				} catch (error) {
					// Per-item error handling: return error info instead of failing entire node
					returnData.push({
						json: {
							error: true,
							message: error instanceof Error ? error.message : String(error),
							url,
						},
						pairedItem: { item: i },
					});
				}
			}
		} finally {
			// Always close PostgreSQL connection
			// Wrap in try-catch to avoid suppressing the original error
			if (postgresAdapter) {
				try {
					await postgresAdapter.close();
				} catch {
					// Ignore close errors - don't mask the original error
				}
			}
		}

		return [returnData];
	}
}
