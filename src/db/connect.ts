import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzleOn>;

/** Postgres connection pool for a connection string (Supabase or any Postgres) */
export function openPool(url: string, options: postgres.Options<Record<string, never>> = {}) {
  // prepare: false — Supabase's transaction pooler (port 6543) can't use prepared statements
  return postgres(url, { prepare: false, ...options });
}

/** Drizzle client over a pool, using the current table definitions */
export function drizzleOn(client: postgres.Sql) {
  return drizzle(client, { schema, casing: "snake_case" });
}

export function connect(url: string, options: postgres.Options<Record<string, never>> = {}) {
  return drizzleOn(openPool(url, options));
}
