# EventDesk

EventDesk is a static HTML/CSS/JavaScript college event management portal powered by Firebase.

## Read This First

This project does **not** use:

- `npm install`
- `pip install`
- Python backend
- React / Next.js / Vite

For normal usage, a user only needs:

- a browser
- internet
- the deployed website URL

The app does **not** require `npm` or Python just to open and use the live website.

## Normal Usage

If someone only wants to use EventDesk:

1. Open the deployed EventDesk URL in Chrome or any modern browser.
2. Sign up or log in from the hosted website.
3. Do not open the HTML files by double-clicking them from the laptop if login or Firebase features need to work.

## What Should Not Be Run For Normal Use

These commands are not needed for normal day-to-day usage:

```bash
npm install
npm run dev
python app.py
python -m http.server
pip install -r requirements.txt
```

Those commands are not part of this repo's normal usage flow.

## Why It Fails On Some Laptops

This repo is a static site, but Firebase Auth and Firestore should be opened through:

- Firebase Hosting, or
- a proper local web server

If the app is opened as a raw file like `file:///.../index.html`, some features can fail.

## Common Errors And What They Mean

### 1. `npm: command not found`

Meaning:
Node.js / npm is not installed on that machine.

Important:
This is only needed if someone wants to deploy the site with Firebase CLI. It is **not** required for someone who is only using the live website.

Fix:
Install Node.js LTS from [nodejs.org](https://nodejs.org/), reopen the terminal, then verify:

```bash
node -v
npm -v
```

### 2. `python: command not found`

Meaning:
Python is not installed on that machine.

Important:
Python is **not required** for this project.

Fix:
No action is needed unless someone specifically wants to start a temporary local server with Python.

### 3. `Open EventDesk through localhost or Firebase Hosting. Auth often fails from a raw file tab.`

Meaning:
The app was opened directly from local files instead of a hosted URL or local server.

Fix:
Use the Firebase Hosting URL, or run the site through a local server on a developer machine.

### 4. `Firestore rules blocked the profile sync. Please deploy the latest rules and try again.`

Meaning:
Firebase rules are missing, outdated, or deployed to the wrong project.

Fix:
Deploy the latest Firebase rules from the correct Firebase project.

### 5. `Network looks unstable right now. Firebase could not reach the server.`

Meaning:
The laptop is offline, firewall-blocked, or the connection is unstable.

Fix:
Reconnect to the internet and try again.

If login works but the events feed still shows unavailable on a Windows laptop or strict office network:

- open the page through `http://localhost/...` or the hosted URL, not `file:///...`
- reopen the events page with `?transport=long-polling`
- example: `http://127.0.0.1:5500/event-desk/events.html?transport=long-polling`

### 6. `Email skipped:`

Meaning:
EmailJS is not fully configured yet.

In this repo, [js/email.js](js/email.js) still contains placeholder values:

- `YOUR_EMAILJS_PUBLIC_KEY`
- `YOUR_EMAILJS_SERVICE_ID`
- `YOUR_CONFIRMATION_TEMPLATE_ID`
- `YOUR_WAITLIST_TEMPLATE_ID`

Fix:
Replace those placeholders with the real EmailJS values before expecting confirmation or waitlist emails to send.

## Step-By-Step Setup On A New Laptop

This section is the simplest full setup guide for running this project on another laptop.

### 1. Install Node.js

Node.js is needed for the external opportunities importer.

1. Open [nodejs.org](https://nodejs.org/)
2. Install the current LTS version
3. Reopen Terminal
4. Verify:

```bash
node -v
npm -v
```

If both commands print version numbers, Node.js is installed correctly.

### 2. Get The Project Files

Clone the repo or copy the project folder onto the laptop.

Example:

```bash
git clone <your-repo-url>
cd <project-folder>
```

If the repo was copied manually, just open the project folder in VS Code or Finder.

### 3. Create The Only Secret File Needed

Create this file:

```text
scripts/external-import/.env
```

Paste the full secret text into that file.

This `.env` file should contain:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

Important:

- this file is private
- do not commit it to GitHub
- do not rename it
- do not place it in another folder
- do not run the `.env` file with Node; it is a config file, not a script

### 4. Run The External Opportunities Sync

From the project root, run:

```bash
node scripts/external-import/run-sync.mjs
```

What this command does:

- reads `scripts/external-import/.env`
- installs importer dependencies automatically if they are missing
- fetches public Unstop opportunities
- writes them into Firestore under `externalEvents`

What success looks like:

```text
Sync complete. Upserted <number> opportunities and deactivated <number>.
```

If that line appears, the external opportunities feed has been refreshed successfully.

### 5. Open The App Correctly

Do not open the app as raw local files like:

```text
file:///...
```

Use one of these instead:

1. Firebase Hosting URL
2. VS Code Live Server
3. another proper local web server that opens the app through `http://localhost/...` or `http://127.0.0.1/...`

Recommended simple local method:

1. Open the folder in VS Code
2. Install the `Live Server` extension if it is not installed
3. Right-click [index.html](index.html)
4. Click `Open with Live Server`

Then open [events.html](events.html) from that running local site.

### 6. Verify That External Opportunities Loaded

Open the events page and first test with wide-open filters:

- `All`
- `All locations`
- `All modes`
- `Everyone`

Then check `External Opportunities`.

If the sync was successful and the app is pointed at the correct Firebase project, the external cards should appear.

### 7. Manual Refresh Before A Demo Or Review

If the external feed needs a fresh update before a demo, run this again from the project root:

```bash
node scripts/external-import/run-sync.mjs
```

That is the only command needed for the external opportunities refresh.

## Important Firebase Note

There is currently a Firebase project mismatch in the repo:

- [.firebaserc](.firebaserc) points to `eventdesk-65742`
- [js/firebase-config.js](js/firebase-config.js) points to `krishna-e9c59`

Before production deployment, make sure Hosting, Auth, Firestore, and Storage are all using the **same** Firebase project. Otherwise the app can deploy to one project and read data from another.

At the moment, the frontend in this repo is configured to read from:

- `krishna-e9c59`

So the importer and deployed Firestore rules should target that same project unless the frontend config is intentionally changed.

## External Opportunities Feed

EventDesk now supports two separate opportunity types:

- campus events from the existing `events` collection
- external opportunities imported into `externalEvents`

This separation is intentional:

- campus events keep EventDesk registration, waitlist, QR attendance, certificates, and leaderboard behavior
- external opportunities are discover-only listings that link back to the original source platform

The public feed merges both collections in the browser, but the student and organizer dashboards continue to use the original campus-event collections only.

### Where External Data Lives

- `externalEvents/{docId}` stores normalized external listings
- `externalSyncStatus/unstop` stores last sync metadata for the Unstop importer

The document IDs are deterministic, so rerunning the importer updates existing opportunities instead of creating uncontrolled duplicates.

### Frontend Behavior

- [events.html](events.html) now supports `All`, `Campus Events`, and `External Opportunities`
- external cards show source labels such as `Unstop`
- external detail pages reuse [event-detail.html](event-detail.html) with conditional rendering
- external detail pages never show EventDesk registration, waitlist, QR attendance, certificate, or leaderboard controls

External detail links use:

```text
event-detail.html?id=<docId>&type=external
```

### Running The External Importer

The hosted EventDesk app stays static. External opportunities are imported by a separate Node utility under [scripts/external-import/README.md](scripts/external-import/README.md).

Install once:

```bash
cd scripts/external-import
npm install
```

Dry run:

```bash
node src/index.js --source=unstop --max-urls=20 --dry-run --verbose
```

Live sync:

```bash
node src/index.js --source=unstop --max-urls=50
```

Optional cutoff:

```bash
node src/index.js --source=unstop --since-hours=24 --max-urls=50
```

### Simplest One-Command Sync

From the project root:

```bash
node scripts/external-import/run-sync.mjs
```

This is the recommended manual sync command for another laptop or before a presentation.

### Automatic Daily Sync For Hosted Use

This repo now includes a GitHub Actions workflow at [.github/workflows/external-opportunities-sync.yml](.github/workflows/external-opportunities-sync.yml).

What it does:

- runs automatically once per day
- can also be started manually from the GitHub `Actions` tab
- imports live Unstop opportunities into the same Firestore project used by the frontend

Why this matters:

- nobody needs to open a terminal every day
- the importer does not need to run from the viewing laptop
- the hosted EventDesk site will show the refreshed external opportunities to all students after the Firestore sync completes

Required GitHub setup:

1. Push this repo to GitHub.
2. Open the repo on GitHub.
3. Go to `Settings` -> `Secrets and variables` -> `Actions`.
4. Create a new repository secret named `FIREBASE_SERVICE_ACCOUNT_JSON`.
5. Paste the full Firebase service account JSON into that secret.

The workflow is currently set to run daily at `00:30 UTC` which is `06:00 AM IST`.

Important:

- do not commit the Firebase Admin JSON into GitHub
- the hosted app reads from Firestore only, so once Firestore is updated, every student using the hosted site sees the new external opportunities
- local laptop demos will also show the same external data as long as the app points to the same Firebase project and is opened through a proper local server or hosted URL

### Importer Configuration

Use one of these for Firebase Admin access:

1. `FIREBASE_SERVICE_ACCOUNT_JSON`
2. `GOOGLE_APPLICATION_CREDENTIALS`

Optional:

- `FIREBASE_PROJECT_ID`

Do not place Admin credentials in browser code. The importer uses Admin SDK credentials only in the Node script, while the main EventDesk site continues using the existing Firebase client config in the browser.

### Source Fragility Note

The first adapter targets public Unstop pages using sitemap discovery plus public AMP detail pages. This is more stable than browser-side scraping, but the source can still change its markup over time. If that happens:

- the hosted frontend should keep showing the last successfully imported `externalEvents`
- only the importer needs maintenance
- campus event flows continue to work as before

## Usage Summary

If a laptop has no `npm` and no Python:

- that is completely okay for normal usage
- they should use the deployed website only
- they should not try to run the project from terminal
- they should not open the project via raw local files if login needs to work

## Only For The Person Deploying The Website

If someone wants to publish changes to Firebase Hosting, that machine **does** need Node.js because Firebase CLI depends on it.

### Deploy Steps

```bash
git clone <your-repository-url>
cd <project-folder>
npm install -g firebase-tools
firebase login
firebase use eventdesk-65742
firebase deploy
```

If the intended Firebase project is not `eventdesk-65742`, update the project selection first and make sure it matches [js/firebase-config.js](js/firebase-config.js).

## Files That Matter Most

- [index.html](index.html): landing page
- [events.html](events.html): event listing
- [login.html](login.html): login page
- [signup.html](signup.html): signup page
- [js/firebase-config.js](js/firebase-config.js): Firebase app config
- [firebase.json](firebase.json): Firebase Hosting / Firestore / Storage config
- [firestore.rules](firestore.rules): Firestore rules
- [storage.rules](storage.rules): Storage rules

## One-Line Summary

For normal usage, open the hosted EventDesk site in a browser. For a manual external-opportunities refresh on another laptop, create `scripts/external-import/.env` and run `node scripts/external-import/run-sync.mjs`.
