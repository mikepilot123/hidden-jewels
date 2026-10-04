# Hidden Jewels Co. — Appointments & Leads

A small internal web app for Hidden Jewels Co., ported from a sister repair-shop
project. Three features, all synced through a shared Postgres database (via a
small Vercel API) so every device sees the same data — each list refreshes
every minute and whenever the app comes back to the foreground:

- **Appointments** — Create / View. Create is a single-page booking form (pick a
  day/time on a calendar, pick a staff member, add client details). The server
  rejects a time another device booked in the meantime. Bookings made before
  syncing existed (stored only in that browser) are uploaded automatically the
  first time the device connects.
- **Leads** — Add / View. Add is a single-page form for entering a lead; View is
  the sales pipeline (New → Contacted → Quoted → Follow-up → Won/Lost) with
  search, status/follow-up filters, and per-lead quoted amounts. Editing a lead
  from the list reopens it in the Add form.
- **Preorders** — Add / View. Tracks rings a client has preordered: the ring,
  size, price, amount paid (deposit) and the balance still owed, plus a status
  (To order → Ordered → Arrived → Collected, or Cancelled) so it's clear which
  rings still need ordering. Further payments can be added from the list.
  The ring field searches the live Hidden Jewels Shopify store: picking a
  product fills in its name, size and price for the chosen variant (custom
  rings can still be typed in).

The lead's item/interest field is plain free text — staff type in whatever the
lead is about, there's no Shopify product catalog integration.

## Local development

No build step. Serve the folder with any static file server, e.g.:

```sh
python3 -m http.server 8000
```

## Backend

`api/leads.js` (one endpoint for leads, appointments, preorders and staff) +
`lib/*.js` deploy as Vercel serverless functions, backed by
a Neon Postgres database. Required environment variables on the Vercel
project:

```txt
DATABASE_URL       # Neon Postgres connection string
INTAKE_PIN         # shared team PIN gating the API
SHOPIFY_STORE_DOMAIN  # optional, defaults to hiddenjewelsco.com
```

## Deploying

- **Frontend**: GitHub Pages, deployed from the `main` branch.
- **Backend**: Vercel, auto-deploys from the same repo's `api/`/`lib/` files.

## Tech

Plain HTML/CSS/JS — no build step, no framework. `@neondatabase/serverless`
is the only backend dependency.
