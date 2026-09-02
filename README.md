# Hidden Jewels Co. — Appointments & Leads

A small internal web app for Hidden Jewels Co., ported from a sister repair-shop
project. Two features:

- **Appointments** — Create / View. Create is a single-page booking form (pick a
  day/time on a calendar, pick a staff member, add client details). Stored in
  the browser's `localStorage`, so it's per-device.
- **Leads** — Add / View. Add is a single-page form for entering a lead; View is
  the sales pipeline (New → Contacted → Quoted → Follow-up → Won/Lost) with
  search, status/follow-up filters, and per-lead quoted amounts. Synced to a
  shared Postgres database via a small Vercel API, so the whole team sees the
  same list. Editing a lead from the list reopens it in the Add form.

The lead's item/interest field is plain free text — staff type in whatever the
lead is about, there's no Shopify product catalog integration.

## Local development

No build step. Serve the folder with any static file server, e.g.:

```sh
python3 -m http.server 8000
```

## Backend

`api/leads.js` + `lib/*.js` deploy as Vercel serverless functions, backed by
a Neon Postgres database. Required environment variables on the Vercel
project:

```txt
DATABASE_URL       # Neon Postgres connection string
INTAKE_PIN         # shared team PIN gating the API
```

## Deploying

- **Frontend**: GitHub Pages, deployed from the `main` branch.
- **Backend**: Vercel, auto-deploys from the same repo's `api/`/`lib/` files.

## Tech

Plain HTML/CSS/JS — no build step, no framework. `@neondatabase/serverless`
is the only backend dependency.
