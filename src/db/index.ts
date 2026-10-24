import "server-only";
import type postgres from "postgres";
import { drizzleOn, openPool, type Db } from "./connect";

// The connection pool is kept on globalThis so dev hot reloads don't open new ones.
// The Drizzle client is not: it caches column names per table, so after a change to
// schema.ts it must be rebuilt (this module re-runs) or queries for new columns fail.
const cache = globalThis as unknown as { raigamPool?: postgres.Sql };
let db: Db | undefined;

export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and add your Supabase connection string.");
  cache.raigamPool ??= openPool(url);
  return (db = drizzleOn(cache.raigamPool));
}
