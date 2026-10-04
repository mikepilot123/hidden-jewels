import { sql } from "./db.js";

export const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function dateFrom(value) {
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Appointment date must be YYYY-MM-DD");
  return raw;
}

function timeFrom(value) {
  const raw = text(value);
  if (!/^\d{2}:\d{2}$/.test(raw)) throw new Error("Appointment time must be HH:MM");
  return raw;
}

function statusFrom(value, fallback = "scheduled") {
  const status = text(value).toLowerCase() || fallback;
  return APPOINTMENT_STATUSES.includes(status) ? status : fallback;
}

function rowToAppointment(row) {
  return {
    id: row.id,
    created: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    client: row.client || "",
    phone: row.phone || "",
    technician: row.technician || "",
    date: row.date ? dateFrom(row.date) : "",
    time: row.time || "",
    notes: row.notes || "",
    status: row.status || "scheduled",
  };
}

async function getAppointment(id) {
  const rows = await sql`SELECT * FROM appointments WHERE id = ${id}`;
  if (!rows.length) throw new Error("Appointment not found: " + id);
  return rowToAppointment(rows[0]);
}

// Another device may have taken the slot since this one last synced — the
// server is the only place that can see every booking, so it has the final
// say on double-booking.
async function assertSlotFree(date, time, ignoreId) {
  const rows = await sql`
    SELECT client FROM appointments
    WHERE deleted_at IS NULL AND status <> 'cancelled'
      AND date = ${date} AND time = ${time} AND id <> ${ignoreId}
    LIMIT 1
  `;
  if (rows.length) throw new Error(`That time was just booked for ${rows[0].client || "another client"} — pick another time.`);
}

export async function listAppointments() {
  const rows = await sql`SELECT * FROM appointments WHERE deleted_at IS NULL ORDER BY date, time`;
  return rows.map(rowToAppointment);
}

export async function addAppointment(p) {
  // Devices uploading their old localStorage bookings send their own ids;
  // ON CONFLICT keeps a retry (or two devices sharing a browser profile)
  // from throwing or duplicating.
  const id = text(p.id) || "A" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const client = text(p.client);
  if (!client) throw new Error("Client name is required");
  const date = dateFrom(p.date);
  const time = timeFrom(p.time);
  const status = statusFrom(p.status);
  const existing = await sql`SELECT id FROM appointments WHERE id = ${id}`;
  if (existing.length) return getAppointment(id);
  if (status === "scheduled" && !p.legacy) await assertSlotFree(date, time, id);
  await sql`
    INSERT INTO appointments (id, client, phone, technician, date, time, notes, status)
    VALUES (${id}, ${client}, ${text(p.phone)}, ${text(p.technician)}, ${date}, ${time}, ${text(p.notes)}, ${status})
    ON CONFLICT (id) DO NOTHING
  `;
  return getAppointment(id);
}

export async function updateAppointment(p) {
  const id = text(p.id);
  if (!id) throw new Error("Appointment ID is required");
  const rows = await sql`SELECT * FROM appointments WHERE id = ${id} AND deleted_at IS NULL`;
  if (!rows.length) throw new Error("Appointment not found — it may have been deleted on another device.");
  const current = rows[0];
  const client = p.client != null ? text(p.client) : current.client;
  if (!client) throw new Error("Client name is required");
  const date = p.date != null ? dateFrom(p.date) : dateFrom(current.date);
  const time = p.time != null ? timeFrom(p.time) : current.time;
  const status = p.status != null ? statusFrom(p.status, current.status) : current.status;
  const moved = date !== dateFrom(current.date) || time !== current.time;
  if (status === "scheduled" && (moved || current.status !== "scheduled")) await assertSlotFree(date, time, id);
  await sql`
    UPDATE appointments
    SET client = ${client},
        phone = ${p.phone != null ? text(p.phone) : current.phone},
        technician = ${p.technician != null ? text(p.technician) : current.technician},
        date = ${date},
        time = ${time},
        notes = ${p.notes != null ? text(p.notes) : current.notes},
        status = ${status},
        updated_at = now()
    WHERE id = ${id}
  `;
  return getAppointment(id);
}

export async function deleteAppointment(p) {
  const id = text(p.id);
  if (!id) throw new Error("Appointment ID is required");
  await sql`UPDATE appointments SET deleted_at = now(), updated_at = now() WHERE id = ${id} AND deleted_at IS NULL`;
  return id;
}
