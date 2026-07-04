import { sql } from "./db.js";

const DEFAULT_TECHNICIANS = [];

export async function listTechnicians() {
  const rows = await sql`SELECT id, name, created_at FROM technicians ORDER BY lower(name) ASC`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    created: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

export async function addTechnician(p) {
  const name = String(p.name || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Staff name is required");
  if (name.length > 80) throw new Error("Staff name is too long");
  const id = "STAFF" + Date.now().toString(36).toUpperCase();
  await sql`
    INSERT INTO technicians (id, name)
    VALUES (${id}, ${name})
    ON CONFLICT (name) DO NOTHING
  `;
  return listTechnicians();
}

export async function deleteTechnician(p) {
  const name = String(p.name || "").trim();
  if (!name) throw new Error("Staff name is required");
  if (DEFAULT_TECHNICIANS.some((defaultName) => defaultName.toLowerCase() === name.toLowerCase())) {
    throw new Error("Default staff can't be deleted");
  }
  await sql`DELETE FROM technicians WHERE name = ${name}`;
  return listTechnicians();
}
