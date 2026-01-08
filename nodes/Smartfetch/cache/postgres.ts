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
	private initPromise: Promise<void> | null = null;

	constructor(credentials: PostgresCredentials, tableName: string) {
		// Handle SSL based on credential configuration
		let sslConfig: boolean | { rejectUnauthorized: boolean } | undefined;

		if (credentials.ssl === 'disable' || credentials.ssl === false) {
			// No SSL
			sslConfig = false;
		} else if (credentials.ssl === 'allow' || credentials.ssl === 'require') {
			// SSL without certificate verification (encrypted but not authenticated)
			sslConfig = { rejectUnauthorized: false };
		} else if (credentials.ssl === 'verify-ca' || credentials.ssl === 'verify-full') {
			// SSL with certificate verification (encrypted and authenticated)
			sslConfig = { rejectUnauthorized: true };
		} else if (credentials.ssl === true || credentials.ssl === undefined) {
			// Default: SSL without certificate verification (matches PostgreSQL 'require' mode)
			// This is the common case for cloud-hosted PostgreSQL and self-signed certs
			sslConfig = { rejectUnauthorized: false };
		} else {
			// Unknown value: default to SSL without verification (permissive for compatibility)
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

		// Use promise-based singleton to prevent race conditions
		// Multiple concurrent calls will await the same promise
		if (!this.initPromise) {
			this.initPromise = this.doInitialize();
		}
		return this.initPromise;
	}

	private async doInitialize(): Promise<void> {
		await this.client.connect();
		try {
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
		} catch (error) {
			// Close connection if table creation fails
			await this.client.end();
			this.initPromise = null; // Allow retry
			throw error;
		}
	}

	private escapeName(name: string): string {
		// PostgreSQL identifier escaping:
		// 1. Strip invalid characters (only allow alphanumeric and underscore)
		// 2. Double any quotes per SQL standard (defensive, even though stripped above)
		const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '');
		const escaped = sanitized.replace(/"/g, '""');
		return `"${escaped}"`;
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
		// Note: JSONB is stored as native object, convert to string for CacheEntry interface
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

		// Note: Parse JSON string to object for JSONB storage
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

	async delete(key: string): Promise<void> {
		await this.ensureInitialized();
		await this.client.query(
			`DELETE FROM ${this.escapeName(this.tableName)} WHERE key = $1`,
			[key],
		);
	}

	async close(): Promise<void> {
		if (this.initialized) {
			await this.client.end();
			this.initialized = false;
		}
	}
}
