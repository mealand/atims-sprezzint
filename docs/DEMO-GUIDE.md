# ATiMs demo guide: three minutes

For interviews, accelerator reviewers and alumni. Everything below runs on the live
site, atims.sprezzint.com, with data created through the real product by
`scripts/seed-demo.ts`. Demo accounts and batches are named "DEMO" and use the
`demo.sprezzint.com` email domain, so nobody mistakes them for real trade.

## Before the call (5 minutes, once)

1. Seed production once (see "Running the seed" below). It prints three trace links
   and writes the demo logins to `scripts/.demo-credentials.json` on your machine.
2. Open the three trace links on your phone and laptop and keep them in tabs. Turn each
   into a QR code if you want reviewers to scan it.
3. Optional: set `VITE_DEMO_TRACES` on the frontend service in Railway (the seed prints
   the exact value) so the landing page "See it live" section links to the three traces.
4. Have a private browser window ready for the registration step.

## The walkthrough

### 0:00 to 0:30. The problem, in one sentence

"Sesame from Nigeria gets rejected at EU ports for pesticide residues and paperwork
gaps. ATiMs does not just record the paperwork. It stops a batch from moving until the
right documents are on file from the right people, and a buyer can check the whole
history on their own phone."

### 0:30 to 1:00. Register with no admin

In the private window, open atims.sprezzint.com and choose **Register**.

- Pick a role, for example **Exporter**. The form asks for what that role really needs:
  CAC number, NEPC exporter number and TIN. A farmer is asked for farm GPS, state, LGA
  and crops; a lab for its ISO 17025 accreditation number.
- Enter the 6-digit code from the email. You land on the exporter dashboard, with the
  badge **Self-verified**.

Point to make: no one at Sprezz approved this account. Trust is tiered: self-verified
(email confirmed and automatic format and uniqueness checks passed) can work straight
away; **KYB-verified** is added later by an admin, or by an inspector for farmers, after
a document review. Every trace shows which tier each party had.

### 1:00 to 1:30. The dashboards

Log in as any demo account (emails and passwords are in your credentials file) to show
its dashboard. Good choices:

- **Exporter**: the pipeline by corridor and the documents still missing.
- **Lab**: the blocked batch is waiting in its test requests.
- **Inspector**: the sign-off queue.
- **Buyer**: inbound batches and "confirm delivery".

Keep this short. The traces are the strongest part of the demo.

### 1:30 to 2:15. Two delivered batches

Open the **EU trace** (Sesame to Rotterdam).

- Green box at the top: **Chain verified in your browser**. Explain it (below).
- **Route and gates**: every stage is ticked. At **Packed**, the lab report is shown
  as issued by a laboratory and covering MRL, aflatoxin and ethylene oxide. At
  **Exported**, the phytosanitary certificate is issued by an inspector and the export
  declaration by the exporter.
- **Custody**: farmer, aggregator, processor, exporter, buyer. Each handover was signed
  by the party taking custody.
- **Documents**: each file is recorded by its SHA-256 fingerprint.

Open the **UAE trace** (Sesame to Dubai). Same route, different rules: the UAE corridor
does not require the EU lab panel, but **Delivered** requires the named buyer's own
signed delivery confirmation. Corridors are data, so adding one is adding rows, not code.

### 2:15 to 2:45. The blocked batch

Open the **blocked trace**. The batch is stuck at **Aggregated**. Under **Packed**,
photos and the packhouse log are ticked, and the lab report is open: *needed from a
laboratory, covering MRL, aflatoxin, ethylene oxide*. The history shows the rejected
attempt to pack it.

Point to make: the processor tried to move it and the system refused, and it says
exactly who must act. A processor uploading its own "lab report" does not count either:
the gate checks who issued each document.

### 2:45 to 3:00. Close

"Live today on two sesame corridors. What we want next is one real corridor pilot with
a cooperative, an exporter and the lab and inspection bodies involved."

## What "verified in your browser" means

When the trace page opens, it downloads the raw event history from the API and checks
it on the viewer's device, without trusting our server:

1. Every event's SHA-256 hash is recomputed from its contents.
2. Every event's link to the one before it (`prev_hash`) is recomputed, so a deleted,
   inserted or reordered event breaks the chain.
3. Every device signature (ed25519) is checked against the signer's public key.
4. Everything the page shows (stages, documents, custody) is matched against that
   verified chain.

If any of that fails, the page says so in red instead of green. Some events, such as
batch creation and document registration, are recorded by the server rather than signed
on a device; the page counts them separately, and they are hash-linked like the rest.

Separately, under **Bitcoin timestamp**, the latest state of the batch is submitted to
OpenTimestamps every few minutes after it changes. Once a Bitcoin block includes it
(usually within hours), the page shows the block height and offers the `.ots` proof file
for anyone to check with the standard `ots` tool. Right after seeding, the newest state
will still show as pending.

## Honest answers to likely questions

- **Is the data real?** No. It is demo data created through the real product, with the
  same code paths a user would follow. Documents are generated PDFs and images marked
  "DEMO DOCUMENT. NOT A REAL CERTIFICATE."
- **Do you have pilots?** Not yet. That is the ask.
- **Payments or stablecoins?** On the roadmap, not built.
- **Offline?** The batch page can queue events while offline and send them on "Sync
  now". There is no installable offline app yet.
- **What if someone edits the database?** The history table refuses updates and
  deletions, and any change made around that breaks the hashes, links or signatures,
  which every trace page checks.

## Running the seed

From a checkout of the repository, on your own machine:

```bash
npm ci
```

```bash
npx tsx scripts/seed-demo.ts --api https://atims-sprezzint-production.up.railway.app
```

- It uses only the public API, exactly like the browser, so it needs no database access
  and no secrets.
- **Email codes.** If the production API has `RESEND_API_KEY` set, codes are really
  emailed and the script asks you to type each one. Addresses on `demo.sprezzint.com`
  only work if that domain has a mailbox. If it does not, send the codes to an inbox you
  read with plus addressing:

  ```bash
  npx tsx scripts/seed-demo.ts --api https://atims-sprezzint-production.up.railway.app --email-pattern "you+atims-{key}@yourdomain.com"
  ```

  Without `RESEND_API_KEY`, the API returns each code and the script needs no input.
- **Rerunning is safe.** Logins, device keys and batch ids are saved per API in
  `scripts/.demo-credentials.json` (gitignored; keep it private, it holds the demo
  passwords). A rerun logs in and only does the steps that are not done yet. `--fresh`
  creates three new batches; `--tag <word>` creates a separate set of demo accounts.
- Local rehearsal: `bash scripts/cloud-setup.sh`, `npm run dev`, then
  `npx tsx scripts/seed-demo.ts --api http://localhost:3000`. The printed links point to
  `http://localhost:5173`.

To act as a demo account in the browser, log in with its email and password from the
credentials file. The browser creates its own signing key on first use; to reuse the
seed's key, paste the account's `device_seed` into **Settings**, signing key backup.
