# EventDesk External Importer

This importer fetches public external opportunities and writes them into Firestore for the static EventDesk frontend.

## Supported Source

- `unstop`

## Install

```bash
cd scripts/external-import
npm install
```

## Configuration

Use one of these credential options:

1. `FIREBASE_SERVICE_ACCOUNT_JSON`
2. `GOOGLE_APPLICATION_CREDENTIALS`

Optional:

- `FIREBASE_PROJECT_ID`

Important:

- The importer writes to Firestore with Admin SDK credentials.
- The target Firebase project should match the project used by the hosted EventDesk frontend.
- For hosted automatic syncing, use the GitHub Actions workflow and store the service account JSON in one of these GitHub repository secrets: `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT`, or `FIREBASE_SERVICE_ACCOUNT_KRISHNA_E9C59`.
- For local backup/manual use, keep a private `.env` file in this folder and do not commit it.

## Run

Simplest one-shot command from the repo root:

```bash
node scripts/external-import/run-sync.mjs
```

This helper:

- reads `scripts/external-import/.env`
- installs importer dependencies automatically if needed
- runs the live Unstop sync

Direct importer commands are still available too.

Dry run:

```bash
node src/index.js --source=unstop --max-urls=20 --dry-run --verbose
```

Live sync:

```bash
node src/index.js --source=unstop --max-urls=50
```

With a time cutoff:

```bash
node src/index.js --source=unstop --since-hours=24 --max-urls=50
```

## Firestore Output

- `externalEvents/{docId}`
- `externalSyncStatus/unstop`

## Notes

- Unstop discovery uses the public sitemap plus public AMP detail pages.
- The importer keeps request volume low by stopping after the requested number of candidate URLs and applying a small delay between detail fetches.
- If a run returns no items or the source fails, stale documents are not deactivated.
- The repo includes an automatic daily sync workflow at `.github/workflows/external-opportunities-sync.yml`.
