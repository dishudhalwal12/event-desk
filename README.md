# EventDesk

EventDesk is a static HTML/CSS/JavaScript college event management portal powered by Firebase.

## Read This First

This project does **not** use:

- `npm install`
- `pip install`
- Python backend
- React / Next.js / Vite

For normal client use, the user only needs:

- a browser
- internet
- the deployed website URL

The client does **not** need `npm` or Python just to open and use the live app.

## What The Client Should Do

If the client only wants to use the project:

1. Open the deployed EventDesk URL in Chrome or any modern browser.
2. Sign up or log in from the hosted website.
3. Do not open the HTML files by double-clicking them from the laptop if login or Firebase features need to work.

## What The Client Should NOT Run

The client does not need to run any of these for normal use:

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
This is only needed if someone wants to deploy the site with Firebase CLI. It is **not** required for a client who is only using the live website.

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

## Important Firebase Note

There is currently a Firebase project mismatch in the repo:

- [.firebaserc](.firebaserc) points to `eventdesk-65742`
- [js/firebase-config.js](js/firebase-config.js) points to `krishna-e9c59`

Before production deployment, make sure Hosting, Auth, Firestore, and Storage are all using the **same** Firebase project. Otherwise the app can deploy to one project and read data from another.

## Client-Friendly Usage Summary

If the client has no `npm` and no Python:

- that is completely okay for normal usage
- they should use the deployed website only
- they should not try to run the project from terminal
- they should not open the project via raw local files if login needs to work

## Only For The Person Deploying The Website

If someone wants to publish changes to Firebase Hosting, that machine **does** need Node.js because Firebase CLI depends on it.

### Deploy Steps

```bash
git clone https://github.com/dishudhalwal12/event-desk.git
cd event-desk
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

## One-Line Answer For The Client

If the client does not have `npm` or Python installed, they can still use EventDesk normally through the hosted website. `npm` is only needed for the person who is deploying the site, and Python is not required for this project.
