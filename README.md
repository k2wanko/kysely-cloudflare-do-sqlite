# kysely-cloudflare-do-sqlite

[Kysely](https://kysely.dev/) dialect for [Cloudflare Durable Objects SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

This package provides a Kysely dialect that allows you to use the powerful type-safe SQL query builder with Cloudflare Durable Objects' SQLite storage.

## Installation

```bash
npm install kysely-cloudflare-do-sqlite kysely
```

## Basic Usage

### 1. Define your database schema

```ts
import { Generated } from 'kysely';

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
```

### 2. Create your Durable Object with Kysely

```ts
import { DurableObject } from "cloudflare:workers";
import { Kysely } from 'kysely';
import { DurableObjectDialect } from 'kysely-cloudflare-do-sqlite';

export class MyDurableObject extends DurableObject {
  db: Kysely<Database>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Kysely<Database>({
      dialect: new DurableObjectDialect({ ctx }),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    // Create tables if they don't exist
    await this.createTables();

    // Query data
    const artists = await this.db.selectFrom("artist").selectAll().execute();

    return new Response(JSON.stringify({ artists }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async createTables() {
    // Create artist table
    await this.db.schema
      .createTable("artist")
      .ifNotExists()
      .addColumn("artistid", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("artistname", "text", (col) => col.notNull())
      .execute();

    // Create album table
    await this.db.schema
      .createTable("album")
      .ifNotExists()
      .addColumn("albumid", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("artistid", "integer", (col) => col.notNull())
      .addColumn("albumtitle", "text", (col) => col.notNull())
      .execute();
  }
}
```

### 3. Configure your Worker

```ts
export type Env = {
  MY_DURABLE_OBJECT: DurableObjectNamespace;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instance") || "default";

    const id = env.MY_DURABLE_OBJECT.idFromName(instanceId);
    const stub = env.MY_DURABLE_OBJECT.get(id);

    return await stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

### 4. Configure wrangler.toml

```toml
name = "my-kysely-app"
compatibility_date = "2025-01-16"

[[durable_objects.bindings]]
name = "MY_DURABLE_OBJECT"
class_name = "MyDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MyDurableObject"]
```

## Advanced Usage

### Transaction

The dialect supports transactions using Cloudflare Durable Objects' `ctx.storage.transaction()`:

```ts
// Simple transaction
await this.ctx.storage.transaction(async () => {
  const artist = await this.db
    .insertInto("artist")
    .values({ artistname: "Transaction Artist" })
    .returningAll()
    .execute();

  await this.db
    .insertInto("album")
    .values({
      artistid: artist[0].artistid,
      albumtitle: "Transaction Album"
    })
    .execute();
});

// Transaction with rollback on error
try {
  await this.ctx.storage.transaction(async () => {
    await this.db
      .insertInto("artist")
      .values({ artistname: "Test Artist" })
      .execute();

    // This will cause the entire transaction to rollback
    throw new Error("Intentional rollback");
  });
} catch (error) {
  console.log("Transaction rolled back:", error.message);
}
```

# License

This project is licensed under the MIT License.
