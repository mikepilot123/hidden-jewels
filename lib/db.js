import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL or POSTGRES_URL must be set");
}

// Neon's HTTP-based driver — each query is a single fetch() call, so there's
// no connection pool to exhaust across the many short-lived serverless
// function invocations a low-traffic shop tool like this gets.
export const sql = neon(connectionString);

// Deploys can reach the API before a manual migration is run. Keep these
// additive migrations idempotent so new tables become available safely on
// the first request after deployment as well as through migrations/*.
let schemaPromise;
export function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS technicians (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_technicians_name ON technicians (lower(name))`;
      await sql`
        CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          customer_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          item TEXT NOT NULL DEFAULT '',
          quoted_amount NUMERIC(12, 2),
          source TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'New',
          follow_up_date DATE,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_leads_deleted_status ON leads (deleted_at, status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads (follow_up_date)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads (updated_at DESC)`;
    })();
  }
  return schemaPromise;
}
