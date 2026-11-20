# ATiMs entity model

Who can use ATiMs, how an account earns trust, and what each role may do.
The rules below are implemented in one place, `api/src/services/access.ts`
(`can(entity, action, batch?)`), and pinned by `api/test/access.test.ts`. If
this document and the code disagree, the code is right and this document has a bug.

## Roles

| Role | Who | Typical work |
|---|---|---|
| `farmer` | Smallholder or farm business | Creates batches at harvest, hands them over |
| `aggregator` | Buys and consolidates from farmers | Receives custody, stores, hands on |
| `processor` | Cleans, sorts, packs | Receives custody, adds packing evidence |
| `exporter` | Licensed exporter | Holds export documents, ships |
| `lab` | ISO 17025 accredited laboratory | Adds lab reports to batches it is assigned to |
| `inspector` | NAQS or other inspection body | Adds phytosanitary and inspection reports; KYB-verifies farmers |
| `buyer` | Importer at destination | Views the batch named for it, confirms delivery |
| `regulator` | Agency oversight (NAFDAC, NEPC, ...) | Read-only view of all batches |
| `admin` | Sprezz operations | Account management and KYB review. Cannot self-register |

## Trust tiers

| Tier | How it is reached | Can log in and act? |
|---|---|---|
| `registered` | Registration form accepted | No. Must confirm the email code first |
| `self_verified` | Email code confirmed **and** automatic checks passed | **Yes, immediately. No admin step** |
| `kyb_verified` | Documents reviewed by an admin, or by a KYB-verified inspector for farmers | Yes |

Automatic checks, run at registration (`shared/src/registration.ts`):

* **Format**: every field is validated (phone in E.164, CAC as `RC`/`BN`/`IT`/`LP`/`LLP` plus digits, TIN, ISO country codes, farm GPS inside Nigeria, ...).
* **Completeness**: every required field for the role is present; unknown fields are rejected, so a client cannot smuggle in `status` or `trust_tier`.
* **Uniqueness**: email (case-insensitive) and registration identifiers. Identifiers are scoped by role, so one company can hold a processor and an exporter account under the same CAC number, but two exporters cannot share one.

| Identifier | Unique per |
|---|---|
| CAC number | role (aggregator, processor, exporter) |
| NEPC exporter number, TIN | exporter |
| ISO 17025 accreditation number | lab |
| Staff ID | inspector organisation, or regulator agency |
| Import licence (optional) | buyer country |

`kyb_verified` records `verified_by` and `kyb_verified_at`. Revoking KYB returns the
account to `self_verified` (or to `registered`, and inactive, if the email was never confirmed).

Database invariant: an account with `status = 'verified'` (the status the auth guard
requires) is never at the `registered` tier (`entities_active_requires_trust`).

## Registration fields per role

Every role sends `name`, `email`, `password` (10 or more characters), `role` and a
role-specific `profile`:

| Role | `profile` fields (required unless marked optional) |
|---|---|
| Farmer | `phone`, `state` (Nigerian state or FCT), `lga`, `farm_gps` `{lat, lng}`, `farm_size_ha`, `crops` (1 to 20), `cooperative` (optional) |
| Aggregator / processor | `cac_number`, `warehouse_location` `{address, state, gps (optional)}` |
| Exporter | `cac_number`, `nepc_number`, `tin` |
| Lab | `iso17025_accreditation_number`, `accreditation_body` (optional) |
| Inspector | `organisation`, `staff_id` |
| Buyer | `company`, `country` (ISO 3166 alpha-2), `import_licence` (optional) |
| Regulator | `agency`, `staff_id` |
| Admin | **Not self-registrable** (403 `ADMIN_NOT_SELF_REGISTRABLE`) |

Example:

```json
{
  "role": "exporter",
  "name": "Kano Agro Exports Ltd",
  "email": "ops@kanoagro.example",
  "password": "a-long-passphrase",
  "profile": { "cac_number": "RC1234567", "nepc_number": "NEPC/EXP/2024/0012", "tin": "12345678-0001" }
}
```

## Permission matrix

Legend: **Y** always; **H** only while the current holder of the batch; **P** only as a
party to the batch (see below); **A** only if assigned to or already contributing to the
batch; **N** named buyer on the batch only; **-** never.

| Action | farmer | aggregator | processor | exporter | lab | inspector | buyer | regulator | admin |
|---|---|---|---|---|---|---|---|---|---|
| `create_batch` | Y | - | - | - | - | - | - | - | - |
| `view_batch` | P | P | P | P | A | A | N | Y | Y |
| `view_evidence_file` | P | P | P | P | A | A | N | Y | Y |
| `append_event` | H | H | H | H | H | H | H | H | H |
| `add_evidence` (any type) | H | H | H | H | H | H | H | H | H |
| `add_evidence` (own reports) | - | - | - | - | A | A | - | - | - |
| `start_handover` | H | H | H | H | H | H | H | H | H |
| `accept_handover` | Y | Y | Y | Y | - | - | Y | - | - |
| `sign_off` | - | - | - | - | - | A | - | - | - |
| `confirm_delivery` | - | - | - | - | - | - | N | - | - |
| `assign_party` (lab or inspector) | H | H | H | H | H | H | H | H | H |
| `review_kyb` | - | - | - | - | - | farmers, if KYB verified | - | - | all but admins |
| `list_entities` | - | - | - | - | - | farmers, if KYB verified | - | - | Y |
| `manage_entities` (suspend, reject, verify) | - | - | - | - | - | - | - | - | Y |
| `ai_assistant` | Y (P for a batch) | same | same | same | same | same | same | same | same |
| `ai_inspector_summary` | - | - | - | - | - | A | - | Y | Y |

Notes:

* **H** in practice: only custody roles ever hold a batch, because only farmers create
  batches and only `farmer`, `aggregator`, `processor`, `exporter` and `buyer` can accept
  a handover. The holder cannot accept its own handover.
* **Party to a batch (P)**: the origin entity, the current holder, any past holder
  (every recipient of a `CUSTODY_TRANSFER`), or the buyer named in `batches.buyer_id`.
* **Own reports**: a lab may add `LAB_REPORT` and `LAB_RESULT`; an inspector may add
  `PHYTOSANITARY_CERT` and `INSPECTION_REPORT` (`REPORT_EVIDENCE_TYPES` in
  `shared/src/roles.ts`). The holder may add any type, but the gate engine still checks
  the issuer role, so a holder-uploaded phytosanitary certificate does not satisfy an
  inspector-only gate.
* **Assignment**: the current holder assigns a lab or inspector with
  `POST /batches/:id/assignments`. Reviewers who have already contributed keep access.
* **Server-derived fields**: evidence `issued_by_role` is the uploader's role and
  `object_key` is computed by the server; client values are ignored.
* An account that is not `status = 'verified'`, or is still at the `registered` tier, is
  denied every action.
* The public trace (`GET /trace/:trace_id`, `GET /verify/:batch_id`) is intentionally
  public: buyers and consumers verify from a QR code without an account.
* `sign_off` and `confirm_delivery` are defined and tested here. Their event routes (the
  inspector sign-off queue and buyer `DELIVERY_CONFIRMED`) are wired in by task T4.

## API

| Endpoint | Purpose |
|---|---|
| `POST /auth/register` | Role-specific registration. Returns the entity at tier `registered` and a `verification` block |
| `POST /auth/verify-email` `{email or nexus_id, code}` | Confirms the code, promotes to `self_verified`, activates, returns a session `token` |
| `POST /auth/resend-code` `{email or nexus_id}` | New code; at most one a minute and five an hour per account |
| `POST /auth/login` `{nexus_id or email, password}` | Works for `self_verified` and `kyb_verified`. `403 EMAIL_UNVERIFIED` before the code is confirmed |
| `GET /entities/me` | Role, profile, trust tier, who verified |
| `GET /entities?role=&trust_tier=` | Admin: all accounts. KYB-verified inspector: farmers (the KYB queue) |
| `POST /entities/:id/kyb` `{decision: approve or revoke, note?}` | Sets or removes `kyb_verified`, records `verified_by` |
| `POST /entities/:id/lifecycle` `{action}` | Admin: `verify` (same as KYB approve), `suspend`, `reject` |
| `POST /batches/:id/assignments` `{entity_id or nexus_id}` | Holder assigns a lab or inspector |

### Email codes

* 6 digits, stored only as an HMAC (keyed with `JWT_SECRET`) bound to the account.
* Valid for 15 minutes, single use, locked after 5 wrong attempts.
* Per-IP rate limits: register 10/min, verify 10/min, resend 5/min, login 20/min.
* Delivery (`api/src/services/email.ts`): when `RESEND_API_KEY` is set, mail goes out
  through the Resend HTTP API from `EMAIL_FROM` (default `ATiMs <no-reply@sprezzint.com>`;
  the domain must be verified in Resend). When it is not set, nothing is sent: the code
  is logged and returned in the API response as `verification.dev_code`. **That mode is
  for development and demos only**; set `RESEND_API_KEY` before real users register.

## Database (migration `004_entities_trust.sql`)

* `entities`: `buyer` added to the role check; new `email`, `phone`, `profile` (jsonb),
  `trust_tier`, `email_verified_at`, `kyb_verified_at`, `verified_by`.
  Existing `verified` accounts became `kyb_verified`; others stay `registered`.
* `entity_identifiers (kind, value)`: uniqueness of registration numbers.
* `email_codes`: hashed codes with expiry, attempts and consumption time.
* `batches.buyer_id`: the buyer named on a batch (set at creation by T4).
* `batch_assignments`: labs and inspectors assigned to a batch.
