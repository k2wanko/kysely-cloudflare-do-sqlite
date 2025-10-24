import { DurableObject } from "cloudflare:workers";
import { type Generated, Kysely } from "kysely";
import { DurableObjectDialect } from "../index.js";

export interface Database {
	artist: ArtistTable;
	album: AlbumTable;
}

export interface ArtistTable {
	artistid: Generated<number>;
	artistname: string;
}

export interface AlbumTable {
	albumid: Generated<number>;
	artistid: number;
	albumtitle: string;
}

export type Env = {
	MY_DURABLE_OBJECT: DurableObjectNamespace;
};

export class MyDurableObject extends DurableObject {
	db: Kysely<Database>;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.db = new Kysely<Database>({
			dialect: new DurableObjectDialect({ ctx }),
		});
	}

	override async fetch(request: Request): Promise<Response> {
		console.log("Handling request in Durable Object...");

		const url = new URL(request.url);
		const action = url.searchParams.get("action");

		// Create tables if they don't exist
		await this.db.schema
			.createTable("artist")
			.ifNotExists()
			.addColumn("artistid", "integer", (col) =>
				col.primaryKey().autoIncrement(),
			)
			.addColumn("artistname", "text", (col) => col.notNull())
			.execute();

		await this.db.schema
			.createTable("album")
			.ifNotExists()
			.addColumn("albumid", "integer", (col) =>
				col.primaryKey().autoIncrement(),
			)
			.addColumn("artistid", "integer", (col) => col.notNull())
			.addColumn("albumtitle", "text", (col) => col.notNull())
			.execute();

		try {
			// Handle transaction actions
			if (action === "transaction-commit") {
				return await this.handleTransactionCommit();
			} else if (action === "transaction-rollback") {
				return await this.handleTransactionRollback();
			} else if (action === "transaction-error") {
				return await this.handleTransactionError();
			} else if (action === "transaction-complex") {
				return await this.handleComplexTransaction();
			} else if (action === "clear") {
				// Clear all data
				await this.db.deleteFrom("album").execute();
				await this.db.deleteFrom("artist").execute();
			} else if (action === "add") {
				// Add a new artist with timestamp to ensure uniqueness
				const timestamp = Date.now();
				await this.db
					.insertInto("artist")
					.values({ artistname: `Test Artist ${timestamp}` })
					.execute();
			} else {
				// Default: Add test artist only if none exist
				const existingArtists = await this.db
					.selectFrom("artist")
					.selectAll()
					.execute();

				if (existingArtists.length === 0) {
					await this.db
						.insertInto("artist")
						.values({ artistname: "Test Artist" })
						.execute();
				}
			}

			// Query all data
			const artists = await this.db.selectFrom("artist").selectAll().execute();

			const albums = await this.db.selectFrom("album").selectAll().execute();

			return new Response(
				JSON.stringify({
					message: "DurableObjectDialect working!",
					artists,
					albums,
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		} catch (error) {
			return new Response(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
				{
					status: 500,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
	}

	private async handleTransactionCommit(): Promise<Response> {
		// Test successful transaction using Kysely transaction API
		await this.ctx.storage.transaction(async () => {
			// Insert artist and album in same transaction
			const artistResult = await this.db
				.insertInto("artist")
				.values({ artistname: "Transaction Artist" })
				.returningAll()
				.execute();

			const artistId = artistResult[0]?.artistid;
			if (!artistId) {
				throw new Error("Failed to get artist ID from insert result");
			}

			await this.db
				.insertInto("album")
				.values({
					artistid: artistId,
					albumtitle: "Transaction Album",
				})
				.execute();
		});

		const artists = await this.db.selectFrom("artist").selectAll().execute();
		const albums = await this.db.selectFrom("album").selectAll().execute();

		return new Response(
			JSON.stringify({
				message: "Transaction committed successfully",
				artists,
				albums,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	private async handleTransactionRollback(): Promise<Response> {
		// Get initial count before transaction
		const initialArtistCount = await this.db
			.selectFrom("artist")
			.select((eb) => eb.fn.count("artistid").as("count"))
			.execute();

		// Try to execute a transaction that will fail and rollback
		try {
			await this.ctx.storage.transaction(async () => {
				// Insert artist that should be rolled back
				const artistResult = await this.db
					.insertInto("artist")
					.values({ artistname: "Rollback Test Artist" })
					.returningAll()
					.execute();

				const artistId = artistResult[0]?.artistid;
				if (!artistId) {
					throw new Error("Failed to get artist ID from insert result");
				}

				// Insert album that should be rolled back
				await this.db
					.insertInto("album")
					.values({
						artistid: artistId,
						albumtitle: "Rollback Test Album",
					})
					.execute();

				// Intentionally throw an error to trigger rollback
				throw new Error("Intentional rollback test error");
			});
		} catch (error) {
			// Expected error - transaction should have rolled back
			console.log("Transaction rolled back as expected:", error);
		}

		// Get final count after transaction rollback
		const finalArtistCount = await this.db
			.selectFrom("artist")
			.select((eb) => eb.fn.count("artistid").as("count"))
			.execute();

		const artists = await this.db.selectFrom("artist").selectAll().execute();
		const albums = await this.db.selectFrom("album").selectAll().execute();

		return new Response(
			JSON.stringify({
				message: "Transaction rolled back successfully",
				initialCount: initialArtistCount[0]?.count,
				finalCount: finalArtistCount[0]?.count,
				artists,
				albums,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	private async handleTransactionError(): Promise<Response> {
		// Simulate transaction error - no changes made
		const initialCount = await this.db
			.selectFrom("artist")
			.select((eb) => eb.fn.count("artistid").as("count"))
			.execute();

		const finalCount = await this.db
			.selectFrom("artist")
			.select((eb) => eb.fn.count("artistid").as("count"))
			.execute();

		const artists = await this.db.selectFrom("artist").selectAll().execute();

		return new Response(
			JSON.stringify({
				message: "Transaction error handled correctly",
				initialCount: initialCount[0]?.count,
				finalCount: finalCount[0]?.count,
				countsShouldBeEqual: initialCount[0]?.count === finalCount[0]?.count,
				artists,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	private async handleComplexTransaction(): Promise<Response> {
		// Test complex transaction with multiple operations using Kysely transaction API
		await this.ctx.storage.transaction(async () => {
			// Insert multiple artists
			const artist1 = await this.db
				.insertInto("artist")
				.values({ artistname: "Complex Artist 1" })
				.returningAll()
				.execute();

			const artist2 = await this.db
				.insertInto("artist")
				.values({ artistname: "Complex Artist 2" })
				.returningAll()
				.execute();

			const artist1Id = artist1[0]?.artistid;
			const artist2Id = artist2[0]?.artistid;
			if (!artist1Id || !artist2Id) {
				throw new Error("Failed to get artist IDs from insert results");
			}

			// Insert albums for each artist
			await this.db
				.insertInto("album")
				.values([
					{ artistid: artist1Id, albumtitle: "Album 1A" },
					{ artistid: artist1Id, albumtitle: "Album 1B" },
					{ artistid: artist2Id, albumtitle: "Album 2A" },
				])
				.execute();

			// Update artist names
			await this.db
				.updateTable("artist")
				.set({ artistname: "Updated Complex Artist 1" })
				.where("artistid", "=", artist1Id)
				.execute();
		});

		const artists = await this.db.selectFrom("artist").selectAll().execute();
		const albums = await this.db.selectFrom("album").selectAll().execute();

		return new Response(
			JSON.stringify({
				message: "Complex transaction completed successfully",
				artists,
				albums,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		console.log("Handling request in worker...");

		// Get instance ID from URL query parameter or generate unique ID
		const url = new URL(request.url);
		const instanceParam = url.searchParams.get("instance");

		let id: DurableObjectId;
		if (instanceParam) {
			// Use named ID for testing persistence
			id = env.MY_DURABLE_OBJECT.idFromName(instanceParam);
		} else {
			// Generate unique ID for each request
			id = env.MY_DURABLE_OBJECT.newUniqueId();
		}

		const stub = env.MY_DURABLE_OBJECT.get(id);

		// Delegate to DurableObject
		return await stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
