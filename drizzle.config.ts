import { defineConfig } from "drizzle-kit";

// Reads DATABASE_URL from .env.local (see .env.example).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: DATABASE_URL may come from the shell instead
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
