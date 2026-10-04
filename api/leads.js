import { listLeads, addLead, updateLead, deleteLead } from "../lib/leads.js";
import { listTechnicians, addTechnician, deleteTechnician } from "../lib/technicians.js";
import { listAppointments, addAppointment, updateAppointment, deleteAppointment } from "../lib/appointments.js";
import { listPreorders, addPreorder, updatePreorder, deletePreorder } from "../lib/preorders.js";
import { listShopifyProducts } from "../lib/shopify.js";
import { ensureSchema } from "../lib/db.js";

// One endpoint for leads, appointments, preorders and staff. Same shape as
// pricechecker's api/intake.js: { action, pin, ...fields } in,
// { ok, ... } out. GET for reads, POST (text/plain, to dodge a CORS
// preflight) for writes.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const body = req.method === "GET" ? (req.query || {}) : readBody(req);

  if (String(body.pin) !== String(process.env.INTAKE_PIN)) {
    return res.status(200).json({ ok: false, error: "Invalid PIN" });
  }

  const action = body.action || "list";
  try {
    await ensureSchema();
    if (action === "list") {
      return res.status(200).json({ ok: true, leads: await listLeads({ includeDeleted: !!body.includeDeleted }) });
    }
    if (action === "add") {
      return res.status(200).json({ ok: true, lead: await addLead(body) });
    }
    if (action === "update") {
      return res.status(200).json({ ok: true, lead: await updateLead(body) });
    }
    if (action === "delete") {
      return res.status(200).json({ ok: true, deletedId: await deleteLead(body) });
    }
    if (action === "listTechnicians") {
      return res.status(200).json({ ok: true, technicians: await listTechnicians() });
    }
    if (action === "addTechnician") {
      return res.status(200).json({ ok: true, technicians: await addTechnician(body) });
    }
    if (action === "deleteTechnician") {
      return res.status(200).json({ ok: true, technicians: await deleteTechnician(body) });
    }
    if (action === "listAppointments") {
      return res.status(200).json({ ok: true, appointments: await listAppointments() });
    }
    if (action === "addAppointment") {
      return res.status(200).json({ ok: true, appointment: await addAppointment(body) });
    }
    if (action === "updateAppointment") {
      return res.status(200).json({ ok: true, appointment: await updateAppointment(body) });
    }
    if (action === "deleteAppointment") {
      return res.status(200).json({ ok: true, deletedId: await deleteAppointment(body) });
    }
    if (action === "listShopifyProducts") {
      return res.status(200).json({ ok: true, products: await listShopifyProducts({ refresh: !!body.refresh }) });
    }
    if (action === "listPreorders") {
      return res.status(200).json({ ok: true, preorders: await listPreorders() });
    }
    if (action === "addPreorder") {
      return res.status(200).json({ ok: true, preorder: await addPreorder(body) });
    }
    if (action === "updatePreorder") {
      return res.status(200).json({ ok: true, preorder: await updatePreorder(body) });
    }
    if (action === "deletePreorder") {
      return res.status(200).json({ ok: true, deletedId: await deletePreorder(body) });
    }
    return res.status(200).json({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String((err && err.message) || err) });
  }
}

function readBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
