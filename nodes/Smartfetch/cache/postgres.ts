import { Client } from 'pg';
import type { CacheAdapter, CacheEntry } from './types';

export interface PostgresCredentials {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: 'disable' | 'allow' | 'require' | 'verify-ca' | 'verify-full' | boolean;
}

export class PostgresCacheAdapter implements CacheAdapter {
	private client: Client;
	private tableName: string;
	private initialized = false;

	constructor(credentials: PostgresCredentials, tableName: string) {
		// Handle SSL - default to require if not explicitly disabled
		let sslConfig: boolean | object | undefined;
		if (credentials.ssl === 'disable' || credentials.ssl === false) {
			sslConfig = false;
		} else {
			// Default to SSL with rejectUnauthorized: false for self-signed certs
			sslConfig = { rejectUnauthorized: false };
		}

		this.client = new Client({
			host: credentials.host,
			port: credentials.port,
			database: credentials.database,
			user: credentials.user,
			password: credentials.password,
			ssl: sslConfig,
		});
		this.tableName = tableName;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;

		await this.client.connect();
		await this.client.query(`
			CREATE TABLE IF NOT EXISTS ${this.escapeName(this.tableName)} (
				key VARCHAR(255) PRIMARY KEY,
				request_url TEXT,
				response JSONB,
				cached_at TIMESTAMPTZ,
				ttl INT
			)
		`);
		this.initialized = true;
	}

	private escapeName(name: string): string {
		// Simple escape for table name - only allow alphanumeric and underscore
		return '"' + name.replace(/[^a-zA-Z0-9_]/g, '') + '"';
	}

	async get(key: string): Promise<CacheEntry | null> {
		await this.ensureInitialized();

		const result = await this.client.query(
			`SELECT key, request_url, response, cached_at, ttl FROM ${this.escapeName(this.tableName)} WHERE key = $1`,
			[key],
		);

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return {
			key: row.key,
			requestUrl: row.request_url,
			response: JSON.stringify(row.response),
			cachedAt: new Date(row.cached_at).getTime(),
			ttl: row.ttl,
		};
	}

	async set(entry: CacheEntry): Promise<void> {
		await this.ensureInitialized();

		await this.client.query(
			`INSERT INTO ${this.escapeName(this.tableName)} (key, request_url, response, cached_at, ttl)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (key) DO UPDATE SET
				request_url = EXCLUDED.request_url,
				response = EXCLUDED.response,
				cached_at = EXCLUDED.cached_at,
				ttl = EXCLUDED.ttl`,
			[entry.key, entry.requestUrl, JSON.parse(entry.response), new Date(entry.cachedAt), entry.ttl],
		);
	}

	async close(): Promise<void> {
		if (this.initialized) {
			await this.client.end();
		}
	}
}
