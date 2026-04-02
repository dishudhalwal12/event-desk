EVENTDESK PROJECT HANDBOOK
==========================

A short guide for understanding, explaining, and presenting the EventDesk project.


1. WHAT IS EVENTDESK?
---------------------

EventDesk is a college event management web application built to make campus events more organized, more engaging, and much easier to manage.

In simple words, it helps two kinds of users:

- Students, who want to discover events, register quickly, attend them, and collect certificates.
- Organizers, who want to create events, manage registrations, track attendance, and run events smoothly.

The app also includes a second useful layer: it shows external opportunities from the internet, such as hackathons, competitions, workshops, and open challenges. These are displayed inside EventDesk so students can discover them easily, but the final application happens on the original source website.

So EventDesk is not only an event listing website. It is a complete event workflow system for campus events, plus an opportunity discovery feed for external events.


2. THE MAIN PROBLEM THIS PROJECT SOLVES
---------------------------------------

In many colleges, event management is still handled in a very scattered way.

- Announcements are posted in different groups or posters.
- Registrations are taken through forms.
- Attendance is often tracked manually.
- Certificates are handled later in a confusing way.
- Students miss good opportunities because information is not organized in one place.

EventDesk solves this by creating one central platform where the full event journey becomes easy to manage and easy to explain.

The idea is simple:

- Internal campus events are managed fully inside EventDesk.
- External opportunities are discovered and displayed inside EventDesk.

This gives students one clean place to explore both campus activities and wider internet opportunities.


3. WHO USES THIS APP?
---------------------

There are two main user roles in EventDesk.

STUDENT

A student can:

- sign up and log in
- browse all available opportunities
- register for campus events
- join a waitlist if seats are full
- receive a QR code for attendance
- see participation history
- download certificates after event completion
- view leaderboard rank based on attendance
- open external opportunities from platforms like Unstop

ORGANIZER

An organizer can:

- create campus events
- add event posters
- set event details like date, venue, category, seats, and deadline
- manage registrations and waitlist
- scan student QR codes for attendance
- mark events as completed
- unlock certificates for attended students

This role-based design makes the app realistic because students and organizers have different responsibilities and different dashboards.


4. HOW THE APP WORKS
--------------------

The best way to understand EventDesk is to follow the flow step by step.

STEP 1: LOGIN AND USER IDENTIFICATION

Users can log in using:

- email and password
- Google Sign-In

After login, the app checks the user profile and role, then sends the user to the correct dashboard.

STEP 2: EVENT DISCOVERY

On the public events page, users can browse:

- all opportunities
- campus events only
- external opportunities only

The page also supports search and filters such as category, location, mode, participation type, and sort order.

STEP 3: CAMPUS EVENT REGISTRATION

If the event is an internal campus event:

- the student opens the detail page
- fills phone number and team details if needed
- confirms registration
- the registration is stored in Firestore
- the student receives a QR code for attendance

If the event is full, the student can join the waitlist instead of registering directly.

STEP 4: ATTENDANCE

During the event, the organizer scans the student QR code.

If the registration is valid and confirmed, attendance is marked in the system.

This makes attendance more reliable and avoids fake manual entry.

STEP 5: EVENT COMPLETION AND CERTIFICATES

After the event is over, the organizer marks it as completed.

Once that happens:

- students who were actually marked attended can download certificates
- the event becomes part of the participation record

STEP 6: LEADERBOARD

Leaderboard ranking is based on real attendance, not just registration.

This is important because it rewards actual participation, not just interest.


5. INTERNAL EVENTS VS EXTERNAL OPPORTUNITIES
--------------------------------------------

This is one of the most important design decisions in the project.

INTERNAL EVENTS

These are created inside EventDesk by organizers.

They support:

- registration
- waitlist
- QR attendance
- completion status
- certificate flow
- leaderboard contribution

EXTERNAL OPPORTUNITIES

These come from public platforms such as Unstop.

They support:

- discovery in the feed
- detail view
- source name display
- direct link to the original platform

They do not support:

- EventDesk registration
- waitlist
- QR attendance
- organizer scanning
- certificate generation in EventDesk

Why this separation matters:

Because external opportunities are not controlled by EventDesk organizers. The platform only surfaces them in a clean way. This is good product thinking and good software design because it avoids mixing two very different workflows into one confusing system.


6. TECH STACK USED
------------------

The project is built using a practical modern web stack.

FRONTEND

- HTML
- CSS
- Bootstrap 5
- Vanilla JavaScript Modules

BACKEND SERVICES

- Firebase Authentication
- Firestore Database
- Firebase Hosting

IMPORTER FOR EXTERNAL OPPORTUNITIES

- Node.js
- Firebase Admin SDK
- Cheerio
- dotenv

Why this stack is a good fit:

EventDesk is designed as a static web app, which means it does not depend on a heavy custom server for normal usage. Firebase acts as the cloud backend for authentication and live data storage. This keeps the architecture simple, scalable, and easier to host.

Some technical keywords a professor may expect to hear:

- role-based access
- static client architecture
- Firestore as source of truth
- modular JavaScript
- QR-based attendance validation
- normalized external data pipeline
- deterministic upsert for imported opportunities


7. HOW EXTERNAL OPPORTUNITIES ARE IMPORTED
------------------------------------------

This feature makes the project stronger and more practical.

The app does not scrape the internet directly in the browser. Instead, it uses a separate importer script.

The flow is:

1. The importer fetches public opportunity data from Unstop.
2. It extracts useful details like title, deadline, source URL, organizer, tags, and description.
3. It normalizes the data into a standard format.
4. It stores the data in Firestore in a separate collection called externalEvents.
5. The frontend reads from Firestore and shows the opportunities inside EventDesk.

This design is better because:

- it is more stable
- it reduces dependency on live website layouts
- it keeps the frontend fast
- previously imported data remains visible even if the source site is temporarily unavailable

In short, EventDesk works like a smart notice board for external opportunities.


8. DATABASE DESIGN IN SIMPLE LANGUAGE
-------------------------------------

The main Firestore collections are:

- users
- events
- registrations
- attendance
- externalEvents
- externalSyncStatus

What each one stores:

- users: name, email, phone, role
- events: internal campus event details
- registrations: who registered for what
- attendance: who actually attended
- externalEvents: imported public opportunities
- externalSyncStatus: last sync status of the importer

Why separate collections were used:

Because different parts of the app solve different problems. Separating data this way keeps the code cleaner and makes the project easier to scale or debug.


9. IMPORTANT PROJECT STRENGTHS
------------------------------

These are good points to mention in viva:

- clean role-based system for student and organizer
- real-time event data using Firestore
- QR-based attendance workflow
- certificate unlocking after verified completion
- leaderboard based on actual attendance
- separate architecture for internal and external opportunities
- practical external opportunity import pipeline
- simple but scalable Firebase-based design

These strengths make the project feel more like a real product and less like a basic academic prototype.


10. LIMITATIONS AND PRACTICAL DECISIONS
---------------------------------------

Every real project has some practical limitations.

In EventDesk:

- external data depends on public source structure
- external opportunities are discovery-only, not directly managed in the app
- media handling had to be adjusted for free-plan limitations
- importer syncing may run on schedule or manually depending on deployment setup

These are reasonable engineering decisions, not weaknesses. In fact, showing awareness of such trade-offs makes the project explanation stronger.


11. FUTURE SCOPE
----------------

Possible improvements for the next version:

- event analytics dashboard
- saved opportunities or bookmarks
- event reminders through email
- more external sources like Devfolio or Devpost
- richer student recommendations
- admin-level reporting
- mobile app version

This shows that the project has a clear upgrade path and long-term usefulness.


12. SHORT VIVA ANSWERS
----------------------

If asked: What is your project?

Answer:
EventDesk is a college event management web application that manages the complete lifecycle of internal campus events, including registration, waitlist, QR attendance, certificates, and leaderboard tracking. It also displays external opportunities from public platforms like Unstop for student discovery.

If asked: Why did you use Firebase?

Answer:
Firebase was used because it provides authentication, cloud database, and hosting in a simple and efficient way. Since the app is mainly static on the frontend, Firebase works well as the backend service without requiring a custom server for normal usage.

If asked: What is unique in this project?

Answer:
The unique part is that the project combines full campus event management with external opportunity discovery in one platform, while still keeping both workflows separate and logically correct.

If asked: Why did you separate external opportunities from internal events?

Answer:
Because internal events are fully managed inside EventDesk, but external opportunities are only discovered and displayed. Keeping them separate avoids mixing QR attendance, certificates, and registration logic with third-party events.

If asked: What is the role of Firestore?

Answer:
Firestore stores the live project data such as users, events, registrations, attendance, and imported external opportunities.


13. FINAL CONCLUSION
--------------------

EventDesk is a practical and modern student-focused web application that solves real college event problems.

It improves event discovery, simplifies event management, verifies attendance through QR, and rewards participation through certificates and leaderboard tracking.

At the same time, it expands student exposure by showing external opportunities from public platforms in the same clean interface.

In one line:

EventDesk is a smart digital desk for campus events and student opportunities.
