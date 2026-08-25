# DB CheckOut

Spanish-first mobile app for Deitemeyer Brothers' small field crew:
final-inspection checklists, site cleanup checklists, and punch-list
repair work — wired into JobTread and the DB Production board.

## How it works

1. The PM moves a finished roof to **Final Inspection** on the DB
   Production board (JobTread) and assigns the crew there. The job
   automatically appears in the crew's app — the app only ever shows
   jobs that need inspection/cleanup or repairs assigned to the user.
2. The crew drives to the job (built-in directions), runs the
   **inspection checklist** and the **cleanup checklist** (both sourced
   from JT Form templates), and reports problems with an annotated
   photo, a location, and a voice note.
3. Voice notes can be spoken in Spanish, English, or a mix — they are
   transcribed **into English** for the office, with the original
   speech kept alongside.
4. Everything syncs back to JobTread: checklists as form submissions,
   problem reports with photos and English notes. The PM reviews and
   assigns repairs on the Production board.
5. The **punch crew** sees assigned repairs in the same app: where to
   go, what to do, what to bring, before/after photos, and a big
   "Terminado" button. When the last repair closes, the job moves to
   **Punch Review** automatically; the PM reviews the photos and notes,
   then sets **Job Completed**.

## Code

```
packages/shared/   JT contract (ids, statuses), API types, ES/EN strings
apps/sync/         Sync server — Node 22+, zero runtime dependencies
apps/mobile/       Crew app — Expo / React Native, Spanish-first
docs/              jobtread-setup.md is the JT build contract
```

**Sync server** (`apps/sync`) — the bridge between the app and JobTread:
queue of pipeline jobs (Final Inspection / Punch List / Punch Review),
form submissions, problem reports → unassigned Punch List tasks, task
completion with the automatic **Punch Review** status flip, and a
webhook receiver. Run it:

```
cp apps/sync/.env.example apps/sync/.env   # add JT_GRANT_KEY + auth vars
node --env-file=apps/sync/.env --import tsx apps/sync/src/index.ts
```

Tests & typecheck (no JT key needed): `npm install && npm test && npm run typecheck`

**Deploying to Vercel:** the repo is Vercel-ready — `api/index.ts` wraps
the same router as a serverless function and `vercel.json` routes every
path to it. In Vercel: Add New Project → import this repo → framework
preset "Other", no build command → set env vars `JT_GRANT_KEY`,
`SESSION_SECRET`, `GOOGLE_CLIENT_ID` (and optionally
`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_ALLOWED_EMAILS`, `WEBHOOK_SECRET`;
paste values only in Vercel's dashboard, never in the repo) → Deploy.
The JobTread webhook URL is then
`https://<project>.vercel.app/webhooks/jobtread/<WEBHOOK_SECRET>`.

**Sign-in** is Google Workspace: the gate screen shows a Sign in with
Google button (accounts on the company domain, plus any addresses in
`GOOGLE_ALLOWED_EMAILS`). The server verifies the Google ID token and
mints its own ~monthly session token, and every report and punch
completion is stamped with the signed-in person's name in JobTread.

**Crew app** (`apps/mobile`) — one Expo codebase, two targets: an
internal **web app** (the DB pattern — deploy the static export to
Vercel, crew adds it to their home screen) and, if ever needed, native
iOS/Android builds via the same code. Run it:

```
cd apps/mobile && npm install
npx expo start --web              # develop in the browser
npx expo export --platform web    # static build (dist/) for Vercel
```

With no server reachable it runs in demo mode on sample data; served
from the same Vercel project as the sync server it uses same-origin
requests and Google sign-in for the real queue. All writes go through
a persistent offline outbox — nothing is lost in a dead spot.

Not built yet (M2): voice capture + ES/EN→English transcription
(`apps/sync/src/voice.ts` holds the interface), photo upload to JT
files, webhook registration, and the PM surfaces (PMs use JobTread
itself meanwhile).

## design/

Design mockups (one file per screen, laid out by `canvas.json`):

| File | Screen |
| --- | --- |
| `Flow.dc.html` | Integration map — Production board → crew app → back to JT |
| `Jobs.dc.html` | Mis trabajos — auto-filled job queue with directions |
| `Main.dc.html` | Job home — Inspección / Limpieza / Reportar problema tiles |
| `Checklist.dc.html` | Inspection checklist — big BIEN / N/A / FALLA buttons |
| `ChecklistEN.dc.html` | Same inspection checklist with EN selected (OK / N/A / FIX) |
| `Report.dc.html` | Report a problem — photo annotation + ES/EN voice → English note |
| `Cleanup.dc.html` | Cleanup checklist with required photo proof |
| `Send.dc.html` | Finish & send to JobTread |
| `PunchList.dc.html` | Punch crew — assigned repairs for a job |
| `PunchItem.dc.html` | One repair — what to do, materials, AFTER photo gate |
| `PMHome.dc.html` | PM — inspections & repairs queue (reports to review, repairs in flight) |
| `PMReview.dc.html` | PM — inspection results with problem reports, set status Punch List |
| `PMAssign.dc.html` | PM — assign a repair: crew member, due date, materials |
| `PMVerify.dc.html` | PM — verify before/after photos, approve & close or send back |
| `PMBoard.dc.html` | PM — desktop Production Board (primary PM surface), synced with JT statuses, with inline review, work-order editing & assignment |

Key design decisions:

- **Spanish first, English second** — every label shows Spanish large
  with English small underneath; an ES·EN pill on every
  inspection, cleanup & punch screen flips which language leads —
  per crew member, remembered on their phone (labels swap too:
  BIEN/FALLA becomes OK/FIX).
- **Voice in any language, notes in English** — the crew speaks
  Spanish, English, or a mix; the office always receives an English
  note, with the original speech shown to the crew for confidence.
- **Glove-friendly & minimal reading** — 44px+ targets everywhere,
  icon-heavy, one primary action per screen.
- **Offline-first** — everything saves locally and syncs when signal
  returns; the app says so in plain words ("Sin señal, no pasa nada").
- **Photo gates** — cleanup proof photos and AFTER photos on repairs
  are required before items can close.
- **Reports can be dismissed** — the PM can mark a report
  no-action-needed with a reason (e.g. pre-existing damage); the photo
  and note stay on the JT job as documentation, and closeout unlocks
  once every report is assigned or dismissed.
- **JT is the system of record** — checklists come from JT Forms,
  queue and assignments come from the Production board (job Status:
  Production → Final Inspection → Punch List → Punch Review → Job Completed), and all
  results land back on the JT job.

Customer names and addresses in the mockups are sample data; PM names
and job statuses come from the real Deitemeyer Brothers JobTread
configuration.
