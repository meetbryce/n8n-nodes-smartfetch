import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
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
		credentials: [
			{
				name: 'httpBasicAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpBasicAuth'] } },
			},
			{
				name: 'httpHeaderAuth',
				required: true,
				displayOptions: { show: { authentication: ['httpHeaderAuth'] } },
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
					{ name: 'None', value: 'none' },
					{ name: 'Basic Auth', value: 'httpBasicAuth' },
					{ name: 'Bearer Auth', value: 'httpBearerAuth' },
					{ name: 'Digest Auth', value: 'httpDigestAuth' },
					{ name: 'Header Auth', value: 'httpHeaderAuth' },
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
				displayName: 'Custom TTL (seconds)',
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

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const authentication = this.getNodeParameter('authentication', i) as string;
			const cacheStorage = this.getNodeParameter('cacheStorage', i) as string;
			const cacheDuration = this.getNodeParameter('cacheDuration', i) as number | string;
			const ttl = cacheDuration === 'custom'
				? (this.getNodeParameter('customTtl', i) as number)
				: (cacheDuration as number);

			// Get cache adapter
			let cacheAdapter: CacheAdapter;
			let postgresAdapter: PostgresCacheAdapter | null = null;

			if (cacheStorage === 'postgres') {
				const credentials = (await this.getCredentials('postgres')) as PostgresCredentials;
				const tableName = this.getNodeParameter('cacheTableName', i) as string;
				postgresAdapter = new PostgresCacheAdapter(credentials, tableName);
				cacheAdapter = postgresAdapter;
			} else {
				cacheAdapter = new MemoryCacheAdapter();
			}

			// Generate cache key (include hashed credentials for security)
			let credentialHash: string | undefined;
			if (authentication !== 'none') {
				const credentials = await this.getCredentials(authentication);
				const credentialString = JSON.stringify(credentials);
				credentialHash = createHash('sha256').update(credentialString).digest('hex').substring(0, 16);
			}
			const cacheKey = generateCacheKey(url, credentialHash);

			// Check cache
			const cachedEntry = await cacheAdapter.get(cacheKey);
			if (cachedEntry && isCacheValid(cachedEntry)) {
				returnData.push({
					json: JSON.parse(cachedEntry.response) as IDataObject,
					pairedItem: { item: i },
				});
				continue;
			}

			// Make request
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
				requestOptions.url = `${requestOptions.url}${separator}${credentials.name}=${credentials.value}`;
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

			// Close postgres connection if used
			if (postgresAdapter) {
				await postgresAdapter.close();
			}
		}

		return [returnData];
	}
}
