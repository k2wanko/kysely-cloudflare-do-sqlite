import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { unstable_startWorker as startWorker } from "wrangler";

// Test data types
interface TestArtist {
	artistid: number;
	artistname: string;
}

interface TestAlbum {
	albumid: number;
	artistid: number;
	albumtitle: string;
}

describe("worker", () => {
	let worker: Awaited<ReturnType<typeof startWorker>>;

	beforeAll(async () => {
		console.log("Starting worker for tests...");
		worker = await startWorker({
			config: path.join(__dirname, "fixtures", "wrangler.jsonc"),
			entrypoint: path.join(__dirname, "fixtures", "simple.ts"),
			dev: {
				inspector: false,
				liveReload: false,
			},
		});
		console.log("Worker started.");
	});

	test("should respond to requests with DurableObjectDialect working", async () => {
		console.log("Sending fetch request to worker...");
		const testInstance = `test-basic-${Date.now()}`;
		const response = await worker.fetch(
			`http://example.com/?instance=${testInstance}`,
		);
		console.log("Response received from worker.");
		const text = await response.text();
		console.log("Response text:", text);
		expect(response.status).toBe(200);

		// Parse JSON response
		const data = JSON.parse(text);
		expect(data.message).toBe("DurableObjectDialect working!");
		expect(Array.isArray(data.artists)).toBe(true);
		expect(data.artists.length).toBeGreaterThan(0);
		expect(data.artists[0]).toHaveProperty("artistid");
		expect(data.artists[0]).toHaveProperty("artistname", "Test Artist");
	});

	test("DurableObjectDialect should create proper table schema", async () => {
		console.log("Testing table schema creation...");
		const testInstance = `test-schema-${Date.now()}`;
		const response = await worker.fetch(
			`http://example.com/?instance=${testInstance}`,
		);
		const data = JSON.parse(await response.text());

		// Verify artist data structure
		expect(data.artists[0]).toHaveProperty("artistid");
		expect(typeof data.artists[0].artistid).toBe("number");
		expect(data.artists[0]).toHaveProperty("artistname");
		expect(typeof data.artists[0].artistname).toBe("string");
	});

	test("DurableObjectDialect should persist data across requests", async () => {
		console.log("Testing data persistence...");

		const testInstance = `test-persistence-${Date.now()}`;

		// First request - creates initial data
		const response1 = await worker.fetch(
			`http://example.com/?instance=${testInstance}`,
		);
		const data1 = JSON.parse(await response1.text());
		const initialCount = data1.artists.length;
		expect(initialCount).toBe(1);

		// Second request - add more data to the same instance
		const response2 = await worker.fetch(
			`http://example.com/?instance=${testInstance}&action=add`,
		);
		const data2 = JSON.parse(await response2.text());
		const afterCount = data2.artists.length;

		// Should have more artists after second request
		expect(afterCount).toBe(2);
		expect(afterCount).toBeGreaterThan(initialCount);
	});

	test("DurableObjectDialect should support data clearing", async () => {
		console.log("Testing data clearing...");

		const testInstance = `test-clear-${Date.now()}`;

		// Add some data first
		await worker.fetch(
			`http://example.com/?instance=${testInstance}&action=add`,
		);
		await worker.fetch(
			`http://example.com/?instance=${testInstance}&action=add`,
		);

		const response1 = await worker.fetch(
			`http://example.com/?instance=${testInstance}`,
		);
		const data1 = JSON.parse(await response1.text());
		expect(data1.artists.length).toBeGreaterThan(0);

		// Clear all data
		const response2 = await worker.fetch(
			`http://example.com/?instance=${testInstance}&action=clear`,
		);
		const data2 = JSON.parse(await response2.text());
		expect(data2.artists.length).toBe(0);
	});

	afterAll(async () => {
		await worker?.dispose();
	});
});

describe("transaction tests", () => {
	let worker: Awaited<ReturnType<typeof startWorker>>;

	beforeAll(async () => {
		console.log("Starting worker for transaction tests...");
		worker = await startWorker({
			config: path.join(__dirname, "fixtures", "wrangler.jsonc"),
			entrypoint: path.join(__dirname, "fixtures", "simple.ts"),
			dev: {
				inspector: false,
				liveReload: false,
			},
		});
		console.log("Worker started for transaction tests.");
	});

	describe("basic transaction operations", () => {
		test("should commit transaction successfully", async () => {
			console.log("Testing successful transaction commit...");
			const testInstance = `test-tx-commit-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute transaction
			const response = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-commit`,
			);
			const data = JSON.parse(await response.text());

			expect(response.status).toBe(200);
			expect(data.message).toBe("Transaction committed successfully");
			expect(data.artists).toBeDefined();
			expect(data.albums).toBeDefined();
			expect(data.artists.length).toBe(1);
			expect(data.albums.length).toBe(1);
			expect(data.artists[0].artistname).toBe("Transaction Artist");
			expect(data.albums[0].albumtitle).toBe("Transaction Album");
			expect(data.albums[0].artistid).toBe(data.artists[0].artistid);
		});

		test("should rollback transaction on explicit error", async () => {
			console.log("Testing transaction rollback...");
			const testInstance = `test-tx-rollback-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute transaction that should rollback
			const response = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-rollback`,
			);
			const data = JSON.parse(await response.text());

			expect(response.status).toBe(200);
			expect(data.message).toBe("Transaction rolled back successfully");
			expect(data.initialCount).toBe(data.finalCount);
			expect(data.artists.length).toBe(0); // No artists should be left after rollback
		});

		test("should rollback transaction on SQL error", async () => {
			console.log("Testing transaction rollback on SQL error...");
			const testInstance = `test-tx-error-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute transaction that should rollback due to SQL error
			const response = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-error`,
			);
			const data = JSON.parse(await response.text());

			expect(response.status).toBe(200);
			expect(data.message).toBe("Transaction error handled correctly");
			expect(data.countsShouldBeEqual).toBe(true);
			expect(data.initialCount).toBe(data.finalCount);
			expect(data.artists.length).toBe(0); // No artists should be persisted due to rollback
		});
	});

	describe("complex transaction scenarios", () => {
		test("should handle complex multi-table transactions", async () => {
			console.log("Testing complex transaction...");
			const testInstance = `test-tx-complex-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute complex transaction
			const response = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-complex`,
			);
			const data = JSON.parse(await response.text());

			expect(response.status).toBe(200);
			expect(data.message).toBe("Complex transaction completed successfully");
			expect(data.artists.length).toBe(2);
			expect(data.albums.length).toBe(3);

			// Check that the first artist was updated
			const updatedArtist = data.artists.find(
				(a: TestArtist) => a.artistname === "Updated Complex Artist 1",
			);
			expect(updatedArtist).toBeDefined();

			// Check that albums are correctly associated
			const artist1Albums = data.albums.filter(
				(a: TestAlbum) => a.artistid === updatedArtist.artistid,
			);
			const artist2Albums = data.albums.filter(
				(a: TestAlbum) => a.artistid !== updatedArtist.artistid,
			);
			expect(artist1Albums.length).toBe(2);
			expect(artist2Albums.length).toBe(1);
		});

		test("should maintain data consistency across transactions", async () => {
			console.log("Testing data consistency across transactions...");
			const testInstance = `test-tx-consistency-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute first transaction
			const response1 = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-commit`,
			);
			const _data1 = JSON.parse(await response1.text());

			// Execute second transaction (complex)
			const response2 = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-complex`,
			);
			const data2 = JSON.parse(await response2.text());

			expect(response1.status).toBe(200);
			expect(response2.status).toBe(200);

			// Should have data from both transactions
			expect(data2.artists.length).toBe(3); // 1 from first + 2 from second
			expect(data2.albums.length).toBe(4); // 1 from first + 3 from second

			// Verify original data is still there
			const originalArtist = data2.artists.find(
				(a: TestArtist) => a.artistname === "Transaction Artist",
			);
			const originalAlbum = data2.albums.find(
				(a: TestAlbum) => a.albumtitle === "Transaction Album",
			);
			expect(originalArtist).toBeDefined();
			expect(originalAlbum).toBeDefined();
			expect(originalAlbum.artistid).toBe(originalArtist.artistid);
		});
	});

	describe("transaction edge cases", () => {
		test("should handle transaction isolation", async () => {
			console.log("Testing transaction isolation...");
			const testInstance = `test-tx-isolation-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Add some initial data
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=add`,
			);

			const initialResponse = await worker.fetch(
				`http://example.com/?instance=${testInstance}`,
			);
			const initialData = JSON.parse(await initialResponse.text());
			const initialCount = initialData.artists.length;

			// Execute transaction that should rollback
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-rollback`,
			);

			// Check that initial data is unchanged
			const finalResponse = await worker.fetch(
				`http://example.com/?instance=${testInstance}`,
			);
			const finalData = JSON.parse(await finalResponse.text());

			expect(finalData.artists.length).toBe(initialCount);
			expect(finalData.artists[0].artistname).toContain("Test Artist");
		});

		test("should handle empty transactions", async () => {
			console.log("Testing empty transaction behavior...");
			const testInstance = `test-tx-empty-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Add some initial data to ensure transaction doesn't affect it
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=add`,
			);

			const beforeResponse = await worker.fetch(
				`http://example.com/?instance=${testInstance}`,
			);
			const beforeData = JSON.parse(await beforeResponse.text());

			// Execute a rollback transaction (which is essentially empty after rollback)
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-rollback`,
			);

			const afterResponse = await worker.fetch(
				`http://example.com/?instance=${testInstance}`,
			);
			const afterData = JSON.parse(await afterResponse.text());

			// Data should be unchanged
			expect(afterData.artists.length).toBe(beforeData.artists.length);
			expect(afterData.artists[0].artistid).toBe(
				beforeData.artists[0].artistid,
			);
		});

		test("should handle sequential transactions correctly", async () => {
			console.log("Testing sequential transactions...");
			const testInstance = `test-tx-sequential-${Date.now()}`;

			// Clear any existing data first
			await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=clear`,
			);

			// Execute multiple transactions in sequence
			const commit1 = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-commit`,
			);
			const _commit1Data = JSON.parse(await commit1.text());

			const commit2 = await worker.fetch(
				`http://example.com/?instance=${testInstance}&action=transaction-commit`,
			);
			const commit2Data = JSON.parse(await commit2.text());

			expect(commit1.status).toBe(200);
			expect(commit2.status).toBe(200);

			// Should have accumulated data from both transactions
			expect(commit2Data.artists.length).toBe(2);
			expect(commit2Data.albums.length).toBe(2);

			// Both should be "Transaction Artist" but with different IDs
			const transactionArtists = commit2Data.artists.filter(
				(a: TestArtist) => a.artistname === "Transaction Artist",
			);
			expect(transactionArtists.length).toBe(2);
			expect(transactionArtists[0].artistid).not.toBe(
				transactionArtists[1].artistid,
			);
		});
	});

	afterAll(async () => {
		await worker?.dispose();
	});
});
