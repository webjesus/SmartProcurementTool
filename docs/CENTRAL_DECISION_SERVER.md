# Central decision server

The decision UI uses PostgreSQL as its source of truth when `DATABASE_URL` is
configured. Extraction, matching, supplier options and evidence stay in the
existing immutable local pilot storage; the central database stores only user
identity, drafts, immutable decision versions and audit events.

## Setup

1. Create one PostgreSQL database that is reachable from the computer running
   SmartProcurementTool.
2. Set `DATABASE_URL` in `.env.local`. Do not commit that file.
3. Apply the schema with `npm run db:migrate`.
4. Build with `npm run build`.
5. Start for LAN access with `npm run start:lan`.
6. Open `http://<server-ip>:3000/lv-vergleich` on the second device.

Both devices must be on the same network and must use the same running
SmartProcurementTool server and PostgreSQL database. Do not create a separate
database on each device. The host firewall may need an inbound rule for TCP
port 3000; the application does not change firewall settings.

The session cookie is HTTP-only, uses `SameSite=Lax`, has path `/` and expires
after 180 days. Production deployments use a secure cookie. The explicit
loopback HTTP exception keeps `localhost` and `127.0.0.1` usable for local
development and verification; non-loopback production deployments must use
HTTPS.

## Storage behavior

- `localStorage` contains only a crash-recovery copy. It is never treated as a
  final decision or as the authoritative draft.
- `decision_drafts` stores the current server draft with optimistic versioning.
- `supplier_decisions` is append-only per project and position. Editing a
  decision creates a new `decision_version` linked by `previous_decision_id`.
- `decision_events` records draft and final-decision activity.
- Decision snapshots contain document revision IDs and evidence references,
  but never PDF bytes.

Draft updates use `expectedVersion`; final decisions use
`expectedDecisionVersion`. A stale write returns HTTP 409 and must be resolved
explicitly in the UI. Open inspectors poll every 20 seconds and refetch after
foregrounding or saving.

## Identity

On first use, the operator enters a display name. The server creates a
persistent user and an opaque, HTTP-only session cookie. This is
`DEMO_IDENTITY`, not authentication: equal display names do not identify the
same person, do not reuse another user's session and never grant a role.
Production authentication can replace this layer without changing the decision
domain model.
