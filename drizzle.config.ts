import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration for production migrations.
 *
 *   npm run db:generate   diff src/db/schema against the last snapshot and write a new SQL migration to ./drizzle
 *                         (needs no database; commit the generated files)
 *   npm run db:migrate    apply ./drizzle to DATABASE_URL (scripts/migrate.ts)
 *
 * The embedded development database never uses these files: it is synced from the schema directly.
 * DRIZZLE_OUT redirects the output, e.g. to a temporary directory for a "migrations are up to date" check in CI.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: process.env.DRIZZLE_OUT || "./drizzle",
  // Only commands that talk to a database (studio, push, check against a live schema) read this; generate does not.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
