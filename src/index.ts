import type {
	DurableObjectState,
	SqlStorageValue,
} from "@cloudflare/workers-types";
import type {
	DatabaseConnection,
	DatabaseIntrospector,
	Dialect,
	DialectAdapter,
	Driver,
	Kysely,
	QueryCompiler,
	QueryResult,
} from "kysely";
import {
	type CompiledQuery,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
} from "kysely";

/**
 * Configuration for DurableObjectDialect
 */
export interface DurableObjectDialectConfig {
	/** CloudFlare Durable Objects */
	ctx: DurableObjectState;
}

/**
 * Driver implementation for CloudFlare Durable Objects SqlStorage
 */
class DurableObjectDriver implements Driver {
	private ctx: DurableObjectState;
	private connection: DurableObjectConnection;

	constructor(config: DurableObjectDialectConfig) {
		this.ctx = config.ctx;
		this.connection = new DurableObjectConnection(this.ctx);
	}

	async init(): Promise<void> {
		// No initialization needed for Durable Objects
	}

	async acquireConnection(): Promise<DatabaseConnection> {
		return this.connection;
	}

	async beginTransaction(connection: DatabaseConnection): Promise<void> {
		// Durable Objects handles transactions via ctx.storage.transaction()
		// Mark the connection as being in a transaction state
		if (connection === this.connection) {
			await this.connection.beginTransaction();
		}
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		// Signal transaction end
		if (connection === this.connection) {
			await this.connection.commitTransaction();
		}
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		// Signal transaction rollback
		if (connection === this.connection) {
			await this.connection.rollbackTransaction();
		}
	}

	async releaseConnection(): Promise<void> {
		// No cleanup needed for Durable Objects - connection is reused
	}

	async destroy(): Promise<void> {
		// No cleanup needed for Durable Objects
	}
}

/**
 * Database connection implementation for CloudFlare Durable Objects SqlStorage
 */
class DurableObjectConnection implements DatabaseConnection {
	private ctx: DurableObjectState;

	constructor(ctx: DurableObjectState) {
		this.ctx = ctx;
	}

	async beginTransaction(): Promise<void> {
		throw new Error(
			"Direct transaction begin is not supported. Use ctx.storage.transaction().",
		);
	}

	async commitTransaction(): Promise<void> {
		// No-op since ctx.storage.transaction() handles commit automatically
	}

	async rollbackTransaction(): Promise<void> {
		// No-op since ctx.storage.transaction() handles rollback automatically
	}

	async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
		try {
			const cursor = this.ctx.storage.sql.exec(
				compiledQuery.sql,
				...(compiledQuery.parameters as SqlStorageValue[]),
			);
			const rows: O[] = [];

			for (const row of cursor) {
				rows.push(row as O);
			}

			return Promise.resolve({
				rows,
				numAffectedRows: undefined,
				insertId: undefined,
			});
		} catch (error) {
			throw new Error(
				`DurableObject SQL execution failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async *streamQuery<O>(
		compiledQuery: CompiledQuery,
	): AsyncIterableIterator<QueryResult<O>> {
		// Durable Objects do not support true streaming, so we execute once and yield the result
		const result = await this.executeQuery<O>(compiledQuery);
		yield result;
	}
}

/**
 * Kysely dialect for CloudFlare Durable Objects SqlStorage
 */
export class DurableObjectDialect implements Dialect {
	private config: DurableObjectDialectConfig;

	constructor(config: DurableObjectDialectConfig) {
		this.config = config;
	}

	createAdapter(): DialectAdapter {
		return new SqliteAdapter();
	}

	createDriver(): Driver {
		return new DurableObjectDriver(this.config);
	}

	createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
		return new SqliteIntrospector(db);
	}

	createQueryCompiler(): QueryCompiler {
		return new SqliteQueryCompiler();
	}
}
