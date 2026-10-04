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
    // Two cold serverless instances running CREATE TABLE IF NOT EXISTS at the
    // same moment (e.g. a page load firing several requests right after a
    // deploy) can make Postgres raise a duplicate-key error on one of them.
    // Retry once, and never keep a failed attempt cached — otherwise that
    // instance answers every later request with the same error until it's
    // recycled (saves landing on a healthy instance, lists failing).
    schemaPromise = createSchema().catch(() => createSchema()).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function createSchema() {
  return (async () => {
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
    await sql`
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        client TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        technician TEXT NOT NULL DEFAULT '',
        date DATE NOT NULL,
        time TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (deleted_at, date, time)`;
    await sql`
      CREATE TABLE IF NOT EXISTS preorders (
        id TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        ring TEXT NOT NULL DEFAULT '',
        ring_size TEXT NOT NULL DEFAULT '',
        total_price NUMERIC(12, 2),
        amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'To order',
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_preorders_deleted_status ON preorders (deleted_at, status)`;
  })();
}
