# ATiMs v1.0 "Pilot-Ready" MVP: work plan for cloud sessions

Goal (3 days): a reviewer, buyer or investor can open atims.sprezzint.com on a phone, **register as any role without waiting for an admin**, land on a polished dashboard for that role, and open live demo batches for two corridors that show every gate passed, issuer trust levels, and **"Chain verified in your browser"**.

Read `CLAUDE.md` first. Each task below is one cloud session and one PR. Tasks list the files they own, so sessions running at the same time do not collide. Run `npm test -w @atims/api` and `npm run build` before creating the PR.

## Order

| Wave | Tasks (parallel within a wave) |
|---|---|
| 1 | **T1** entity model and trust (api, shared) and **T2** UI foundation (frontend) |
| 2 | **T3** registration and dashboards (frontend), **T4** corridors and trust fixes (api) |
| 3 | **T5** batch detail, trace page and anchoring |
| 4 | **T6** demo seed, integration test, docs |

---

## T1: Entity model, permissions, tiered trust, registration API
**Owns:** `api/src/db/sql/004_entities_trust.sql`, `api/src/services/access.ts`, `api/src/services/email.ts`, `shared/src/registration.ts`, `shared/src/roles.ts`, `api/src/routes/auth.ts`, `api/src/routes/entities.ts`, access guards in `api/src/routes/{batches,evidence,handover,trace,ai}.ts`, `docs/ENTITY-MODEL.md`, new tests in `api/test`.

1. **Roles:** farmer, aggregator, processor, exporter, lab, inspector, **buyer** (new), regulator, admin. Add `buyer` to the DB check constraint and shared types.
2. **`docs/ENTITY-MODEL.md`:** a permission matrix (role by action) and the registration fields per role.
3. **`api/src/services/access.ts`:** a single `can(entity, action, batch?)` used by every route. Actions include: create_batch, view_batch, append_event, add_evidence, view_evidence_file, start_handover, accept_handover, sign_off, confirm_delivery, review_kyb.
   * A batch is visible to its origin entity, current and past holders, inspectors and labs who have contributed or are assigned, the buyer named on the batch, regulators, and admins.
   * Evidence upload is allowed for the current holder, and for labs and inspectors adding their own reports. Never for others.
   * `object_key` and issuer role are derived server-side, never taken from the client.
4. **Registration** (`POST /auth/register`) validates the role-specific fields with Zod schemas from `shared/src/registration.ts`. The same schemas are reused by the frontend wizard.

   | Role | Required fields |
   |---|---|
   | Farmer | phone, state, LGA, farm GPS (lat/lng), farm size (ha), crops, optional cooperative |
   | Aggregator / processor | CAC registration number, warehouse location |
   | Exporter | CAC RC number, NEPC exporter number, TIN |
   | Lab | ISO 17025 accreditation number |
   | Inspector | organisation, staff ID |
   | Buyer | company, country, optional import licence |
   | Regulator | agency, staff ID |

   **Admin cannot self-register.**
5. **Tiered trust:** `trust_tier` is one of `registered`, `self_verified` or `kyb_verified`.
   * `self_verified` = email code confirmed **and** automatic checks pass (format, uniqueness, completeness). Self-verified accounts can log in and act immediately. **No admin step.**
   * `kyb_verified` is set by an admin, or by an inspector for farmers (`POST /entities/:id/kyb`), and records `verified_by`.
6. **Email codes:** `POST /auth/verify-email`, `POST /auth/resend-code`. A 6-digit code, hashed, 15-minute expiry, rate limited.
   * `api/src/services/email.ts` is a provider adapter. It uses the Resend HTTP API when `RESEND_API_KEY` is set. Otherwise it returns the code in the API response as `dev_code` (dev and demo only) and logs it.
7. Login works for `self_verified` and `kyb_verified`. `GET /entities/me` returns role, profile and trust tier.
8. Existing verified entities become `kyb_verified`. Existing pending entities stay `registered`.
9. **Tests:** the permission matrix, the registration schemas per role, the email code flow (expiry, wrong code, reuse), and that admin self-registration is rejected.

## T2: UI foundation (Tailwind, components, app shell)
**Owns:** `frontend/package.json`, Tailwind config, `frontend/src/styles.css`, `frontend/src/components/ui/*`, `frontend/src/components/DashboardLayout.tsx`, `frontend/src/pages/Home.tsx`, `frontend/src/pages/auth/Login.tsx`, `frontend/index.html` (fonts and meta).

1. Install **Tailwind CSS** and set brand tokens: crimson `#A81D1D` primary, plus the role colours from `frontend/src/lib/brand.ts`. Support light theme, and dark if cheap.
2. Accessible components in `components/ui`, shadcn style, on Radix primitives where needed:
   * Button, Card, Input, Select, Textarea, Label;
   * Badge (including a TrustBadge for registered, self-verified and KYB verified);
   * Stepper, Tabs, Dialog, Toast, EmptyState, Skeleton, StatCard;
   * a ResponsiveTable that shows as cards on mobile.
3. App shell: **bottom navigation on phones and a sidebar on desktop**, a header with the user's role and trust badge, and role-aware nav items.
4. Redesign **Home** (landing: problem, how it works, two corridors, "Try it: register as any role", links to live demo traces) and **Login**. Mobile first.
5. Keep all existing pages working: wrap them in the new shell. Don't change `frontend/src/lib/*` behaviour.
6. Target Lighthouse mobile accessibility of 90 or more on Home and Login.

## T3: Registration wizard, email code, role dashboards (after T1 and T2)
**Owns:** `frontend/src/pages/auth/*` (except Login), `frontend/src/pages/dashboards/*` (new), `frontend/src/pages/Settings.tsx`, `frontend/src/main.tsx` routes.

* Multi-step wizard: choose role (cards with icons and descriptions), then role details (`shared/src/registration.ts` schemas, GPS button for farmers), then account, then the email code step (shows `dev_code` when present), then the dashboard.
* Dashboards, one per role, built on shared components:
  * **Farmer:** my batches, next gate checklist, create batch, hand over.
  * **Aggregator / processor:** incoming handovers, batches to pack.
  * **Exporter:** pipeline by corridor, missing documents.
  * **Lab:** test requests, upload results.
  * **Inspector:** sign-off queue.
  * **Buyer:** inbound batches, verify, confirm delivery.
  * **Regulator:** read-only corridor overview.
  * **Admin:** KYB review queue.
* Settings: profile, trust tier, device key backup, password.

## T4: Corridors and trust fixes (after T1)
**Owns:** `api/src/db/sql/005_corridors.sql`, `api/src/services/gates.ts`, gate and append logic in `api/src/routes/batches.ts`, `api/src/routes/handover.ts`, `frontend/src/pages/handover/HandoverAccept.tsx`, inspector queue API, tests.

* `corridors` table: `NG-EU-SESAME` and `NG-AE-SESAME`. `batches.corridor` and `batches.buyer_id` are chosen at creation. `stage_requirements` become corridor-scoped. Existing rules become corridor `DEFAULT`.
  * **EU:** PACKED needs PHOTO, PACKHOUSE_LOG and LAB_REPORT (lab issuer: MRL, aflatoxin, ethylene oxide). EXPORTED needs PHYTOSANITARY_CERT (inspector only), EXPORT_DECLARATION (exporter) and CERTIFICATE_OF_ORIGIN.
  * **UAE:** PACKED needs PHOTO and PACKHOUSE_LOG. EXPORTED needs PHYTOSANITARY_CERT (inspector only), EXPORT_DECLARATION and CERTIFICATE_OF_ORIGIN. DELIVERED needs a buyer `DELIVERY_CONFIRMED` event.
* **F4:** only the next stage is allowed, unknown stages are rejected, system event types (BATCH_CREATED, GATE_REJECTED, CUSTODY_TRANSFER, EVIDENCE_ADDED) are server-only, and the gate failure report is returned without writing on a dry-run.
* **F3 and F11:**
  * Custody moves only through handover. The scanner parses the full handover URL.
  * Accepting a handover is one transaction (`SELECT ... FOR UPDATE` on the token and the batch), and only eligible roles can accept.
  * `created_at` follows the same window as events.
* Inspector queue endpoint: batches with evidence awaiting phyto or inspection sign-off.

## T5: Batch detail, public trace, anchoring (after T3 and T4)
**Owns:** `frontend/src/pages/dashboard/BatchDetail.tsx`, `frontend/src/pages/Trace.tsx`, `frontend/src/pages/Verify.tsx`, `api/src/routes/trace.ts`, `api/src/services/{anchorJob,ots}.ts`.

* **Batch detail:** stage timeline, gate checklist (ticks and missing items with the role that must supply them), evidence cards with issuer trust badge, custody history, and a printable QR label linking to `/trace/:trace_id`.
* **Public trace:** run `verifyChainIndependent` from `shared/src/verify.ts` **in the browser** and show "Chain verified in your browser" only when it passes. Also show:
  * the corridor and the gates passed;
  * issuer trust tiers, for example "Phyto certificate issued by a self-verified inspector";
  * an evidence list with hashes;
  * the anchor status.
* **F10:** re-anchor whenever a batch's head hash changes; fix the Bitcoin attestation parser (8-byte tag + varint height); add a re-entrancy guard.

## T6: Demo, integration test, docs (last)
**Owns:** `scripts/seed-demo.ts`, `api/test/integration/*`, `.github/workflows/ci.yml`, `README.md`, `docs/ALLIANCE-PITCH.md`, `docs/DEMO-GUIDE.md`.

* `scripts/seed-demo.ts`, run against any API URL, uses the real signed flow. It creates demo accounts for each role (marked DEMO) and:
  * one complete EU batch;
  * one complete UAE batch with buyer confirmation;
  * one EU batch blocked at PACKED for a missing lab report.

  It prints the trace URLs. Credentials go to a gitignored file.
* Integration test in CI with a Postgres service container: register, email code, create, evidence, advance, handover, buyer confirms, trace valid.
* Remove the over-claims from `README.md` and the pitch.
* `docs/DEMO-GUIDE.md`: a 3-minute walkthrough.

## Definition of done (whole MVP)
1. In a phone's private window: register as an exporter, enter the email code, land on the exporter dashboard. No admin involved.
2. Open each demo trace from its QR code: "Chain verified in your browser", the corridor gates are ticked, and issuer tiers are visible.
3. The blocked demo batch shows exactly what is missing and who must supply it.
4. CI is green, including the integration test. Railway deploys are healthy.
