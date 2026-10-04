import { sql } from "./db.js";

// "To order" = deposit taken, ring not yet ordered from the supplier.
export const PREORDER_STATUSES = ["To order", "Ordered", "Arrived", "Collected", "Cancelled"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function moneyFrom(value, label) {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(label + " must be a valid non-negative amount");
  return (Math.round(Number(raw) * 100) / 100).toFixed(2);
}

function statusFrom(value, fallback = "To order") {
  const status = text(value) || fallback;
  return PREORDER_STATUSES.includes(status) ? status : fallback;
}

function rowToPreorder(row) {
  const total = row.total_price == null ? null : Number(row.total_price);
  const paid = Number(row.amount_paid || 0);
  return {
    id: row.id,
    created: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    customerName: row.customer_name || "",
    phone: row.phone || "",
    ring: row.ring || "",
    ringSize: row.ring_size || "",
    totalPrice: total == null ? "" : total.toFixed(2),
    amountPaid: paid.toFixed(2),
    balance: total == null ? "" : Math.max(0, total - paid).toFixed(2),
    status: row.status || "To order",
    notes: row.notes || "",
  };
}

async function getPreorder(id) {
  const rows = await sql`SELECT * FROM preorders WHERE id = ${id}`;
  if (!rows.length) throw new Error("Preorder not found: " + id);
  return rowToPreorder(rows[0]);
}

export async function listPreorders() {
  const rows = await sql`SELECT * FROM preorders WHERE deleted_at IS NULL ORDER BY created_at DESC`;
  return rows.map(rowToPreorder);
}

export async function addPreorder(p) {
  const id = "P" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const customerName = text(p.customerName);
  if (!customerName) throw new Error("Client name is required");
  const ring = text(p.ring);
  if (!ring) throw new Error("Ring is required");
  await sql`
    INSERT INTO preorders (id, customer_name, phone, ring, ring_size, total_price, amount_paid, status, notes)
    VALUES (
      ${id},
      ${customerName},
      ${text(p.phone)},
      ${ring},
      ${text(p.ringSize)},
      ${moneyFrom(p.totalPrice, "Price")},
      ${moneyFrom(p.amountPaid, "Amount paid") || "0.00"},
      ${statusFrom(p.status)},
      ${text(p.notes)}
    )
  `;
  return getPreorder(id);
}

export async function updatePreorder(p) {
  const id = text(p.id);
  if (!id) throw new Error("Preorder ID is required");
  const rows = await sql`SELECT * FROM preorders WHERE id = ${id} AND deleted_at IS NULL`;
  if (!rows.length) throw new Error("Preorder not found — it may have been deleted on another device.");
  const current = rows[0];
  const customerName = p.customerName != null ? text(p.customerName) : current.customer_name;
  if (!customerName) throw new Error("Client name is required");
  const ring = p.ring != null ? text(p.ring) : current.ring;
  if (!ring) throw new Error("Ring is required");
  const totalPrice = p.totalPrice != null ? moneyFrom(p.totalPrice, "Price") : moneyFrom(current.total_price, "Price");
  const amountPaid = p.amountPaid != null ? (moneyFrom(p.amountPaid, "Amount paid") || "0.00") : moneyFrom(current.amount_paid, "Amount paid");
  await sql`
    UPDATE preorders
    SET customer_name = ${customerName},
        phone = ${p.phone != null ? text(p.phone) : current.phone},
        ring = ${ring},
        ring_size = ${p.ringSize != null ? text(p.ringSize) : current.ring_size},
        total_price = ${totalPrice},
        amount_paid = ${amountPaid},
        status = ${p.status != null ? statusFrom(p.status, current.status) : current.status},
        notes = ${p.notes != null ? text(p.notes) : current.notes},
        updated_at = now()
    WHERE id = ${id}
  `;
  return getPreorder(id);
}

export async function deletePreorder(p) {
  const id = text(p.id);
  if (!id) throw new Error("Preorder ID is required");
  await sql`UPDATE preorders SET deleted_at = now(), updated_at = now() WHERE id = ${id} AND deleted_at IS NULL`;
  return id;
}
