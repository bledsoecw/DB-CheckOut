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
   **inspection checklist** and the **cleanup checklist** — the checklist
   on the job's scheduled **"Final inspection"** task — and reports
   problems with an annotated photo, a location, and a voice note.
3. Voice notes can be spoken in Spanish, English, or a mix — they are
   transcribed **into English** for the office, with the original
   speech kept alongside.
4. Everything syncs back to JobTread: problem reports as Punch List
   to-dos with photos and English notes, and the visit itself onto the
   scheduled tasks. The PM reviews and assigns repairs on the Production
   board.
5. Finishing the visit writes both checklists onto the job's
   **"Final inspection"** task — the eight inspection checks and the five
   cleanup checks are its subtasks, the notes go in its description — and
   completes it, so the app ticks the same boxes the PM sees on the Gantt.
   Found anything posts a **"PUNCH LIST TO SCHEDULE"** message on the job's
   "Punch list" task — every repair, the crew's note, who it is assigned to,
   the problem photos linked — tagged to **that work area's reviewer**, so
   he can book the repair day. (No JT Forms: the inspection and cleanup
   forms were retired on 2026-09-21.)
6. **A roofing job is closed out one work area at a time** (Carl, 23 Oct
   2026) — the roof, the siding, the gutters, each off the job's Project
   Types. The roof's is the template line above; every other area has its
   own **"Final inspection — Gutters"** task, booked by the PM on the
   Production Board, and is inspected with **notes and photos**
   (`POST /jobs/:id/close-area-inspection`) rather than the roof checklist.
   A finding carries its area (`"Gutters · reported by Yahir"` in its
   description), and goes to whoever that area's repairs go to: Alberto and
   Yahir on a shingle roof, nobody else by default.
7. The **punch crew** sees assigned repairs in the same app: where to
   go, what to do, what to bring, before/after photos, and a big
   "Terminado" button. The job's scheduled **"Punch list"** task mirrors
   the open repairs as its checklist and completes with the last one.
   Each finished repair posts a **message on its own to-do** — "✔ REPAIR
   DONE — <the crew's note>", who finished it — with its before and after
   photos linked. When the **last repair on a work area** closes, one
   summary — every finished repair of **this round**, its note, who did
   it, each after photo linked — is posted for **that area's reviewer**.
   A round starts after the review summary that came before it (Carl, 26
   Oct 2026: a second punch list sent the PM all seventeen repairs again
   for the one he had just asked for); earlier rounds get one line, "16
   repairs from earlier rounds already reviewed — not repeated here", and
   their photos are not linked again (`currentRound` in `jt.ts`). A clean inspection
   posts the same kind of summary (who inspected, how the checklist came
   out, what was fixed on site, the crew's notes, the visit photos). The
   roof's go on the template's **"PM punch review"** task; any other
   area's go on the job, since it has no review step of its own.
8. **The PM approves each area, or puts it on a punch list, on the
   Production Board** (its Close-out panel). Who reviews which area is
   Operations' list on the board — Dave Elick the shingle roofs, Neal the
   gutters, the job's own PM for metal, low slope and siding — and Close
   Out asks the board each time (`src/board.ts`), so a change there needs
   no deploy here.
9. **Close Out does not write the Status of a job with work areas** (Carl,
   23 Oct 2026: "the board sets the Status, Close Out stops"). After an inspection closes, a
   finding is reported on a job already past Punch List, or a repair
   finishes, the server tells the board (`POST {BOARD_URL}/api/hooks/closeout`),
   and the board moves the Status by its own rule — the work area furthest
   behind decides, forward only: Production → Final Inspection → Punch
   List → PM Review → **Sales Rep > Cust Final Contact** once every area is
   approved. The sales rep speaks to the customer and sets **Job
   Completed** by hand. Without the board configured, the board's hourly
   sweep moves it instead. **A job with no work areas** — a service call
   (R-Repairs/Service, R-Warranty), a construction job — is not the
   board's loop, so Close Out still moves it by the rule it always had:
   Final Inspection → Punch List or PM Review when the inspection closes,
   Punch List → PM Review when the last repair closes, PM Review → Job
   Completed when the sales rep ticks "Final check-off".

10. **The form is the server's** (29 Oct 2026). The job detail carries
   `forms` and `jobForm` (`packages/shared/src/forms.ts`); DB Crew draws the
   job's form — sections of OK · N/A · Fix items, one note a section — and the
   close sends `form` with the answers and notes by section. The roof form is
   built from `INSPECTION_ITEMS` / `CLEANUP_ITEMS` and `FIELD_LABELS`, so the
   checklist close-inspection writes and the items the crew answers cannot
   disagree. Rewording an item, or adding a form (the construction
   walk-through, to be written with Neal), is a change here and a deploy, not
   a phone release — but a new form needs its write path in close-inspection
   too, and until it has one close-inspection refuses it (400, *"The walk form
   is not written to JobTread yet — ask the office."*) rather than writing it
   as the roof's. `jobFormKey()` answers `roof` for every job's line.
11. **The gutters and the siding have their own checklists** (DB Crew T2.27,
   29 Oct 2026: *"create check lists for gutter and siding final
   inspections"*). `GUTTERS_FORM` (G1–G8, then cleanup GC1–GC3) and
   `SIDING_FORM` (S1–S8, then SC1–SC3) sit beside the roof's in
   `CLOSEOUT_FORMS`, their items in `packages/shared/src/jobtread.ts` and their
   short labels in `FIELD_LABELS`. A job's `areas[].form` names the one each
   area draws (`areaFormKey`): `roof` on the line roof, `gutters` / `siding`
   on theirs, `notes` on a second roof. `close-area-inspection` takes `form`,
   `answers`, `sectionNotes` and `findings` beside `notes` (the final notes),
   writes the area's items as the checklist of its own inspection task — the
   office's own lines on that task kept after them — stamps it, and posts the
   section notes and the final notes as one message (`areaChecklistMessage`).
   A form that is not the area's is a 400; a phone that sends none is written
   as notes and photos, as before. The close-inspection's `notes.final` is
   the roof's final notes ("Final notes: …" on the notes message). A repair's
   extra photos come as `REPAIR` (`PHOTO_LABELS`) with the send's reference
   `.m0`, `.m1`…, and its done message links them after the before and after.
   The items are a first draft for the office to reword here.

The six pipeline tasks come from the **"Roofing Schedule - Phase I"** task
template, copied onto every job. `docs/jobtread-setup.md` is the contract:
the task types on it are load-bearing, not decoration.

## Code

```
packages/shared/   JT contract (ids, statuses), API types, ES/EN strings
apps/sync/         Sync server — Node 22+, zero runtime dependencies
apps/mobile/       Crew app — Expo / React Native, Spanish-first
docs/              jobtread-setup.md is the JT build contract
```

**Sync server** (`apps/sync`) — the bridge between the app and JobTread:
queue of pipeline jobs (Final Inspection / Punch List / PM Review, plus any
job with close-out work assigned to the person asking, whatever its
Status — each of their jobs carrying `booked`, the days that work is booked
for, so DB Crew can file the Assigned list under its days), the visit's checklists onto the "Final inspection" task, a work
area's notes-and-photos close, problem reports → Punch List to-dos filed
under their area, task completion, the close-out (`src/pipeline.ts` — the
checklist mirrors and the summaries to each area's reviewer; `src/areas.ts`
— the work areas, named exactly as the board names them; `src/board.ts` —
the door to the board, which owns the Status), and a webhook receiver.
Run it:

```
cp apps/sync/.env.example apps/sync/.env   # add JT_GRANT_KEY + auth vars
node --env-file=apps/sync/.env --import tsx apps/sync/src/index.ts
```

Tests & typecheck (no JT key needed): `npm install && npm test && npm run typecheck`

Production deploys build from the `main` branch.

**Deploying to Vercel:** the repo is Vercel-ready — `api/index.ts` wraps
the same router as a serverless function and `vercel.json` routes every
path to it. In Vercel: Add New Project → import this repo → framework
preset "Other", no build command → set env vars `JT_GRANT_KEY`,
`SESSION_SECRET`, `GOOGLE_CLIENT_ID` (and optionally
`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_ALLOWED_EMAILS`, `WEBHOOK_SECRET`;
paste values only in Vercel's dashboard, never in the repo) → Deploy.
The JobTread webhook URL is then
`https://<project>.vercel.app/webhooks/jobtread/<WEBHOOK_SECRET>`.

**The Production Board** is asked after every close (`src/board.ts`):
set `BOARD_URL` (the board's origin, `https://ops.deitemeyerbrothers.com`)
and `CLOSEOUT_HOOK_SECRET` — the SAME value as the board's
`CLOSEOUT_HOOK_SECRET`. Both set, the board moves the job's Status the
moment the crew closes something and names each work area's reviewer;
either missing, summaries are tagged to the fallback reviewers in
`src/areas.ts` and the board's hourly sweep moves the Status. Nothing the
crew sends can fail over it. `GET /health` reports it as `board`.

**The crew's face is DB Crew now (Oct 2026).** The inspection, cleanup,
report and repair screens were redrawn inside DB Crew
(`bledsoecw/db-crew-app`, the former DB Time Clock), so the service crew has
one app, and this repo is the SERVER behind that tab. The Expo app under
`apps/mobile` still builds and still works, but it is no longer what gets
installed on a phone. DB Crew's Apps Script calls this server for the
signed-in person with a shared secret: set `CREW_APP_SECRET` in Vercel (same
value as that script's `CLOSEOUT_SECRET` property) and every protected route
accepts `Authorization: Bearer <that secret>` plus `X-Acting-Email` /
`X-Acting-Name`, the person being gated by the same domain / allow-list rule a
sign-in passes. Unset, the door does not exist. `GET /health` reports it as
`crewApp`. `POST /translate` also takes `to: "en"` now, which is how a note
dictated in Spanish on that app becomes the English the office reads.

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

Without a configured server (or on localhost) it offers a demo on
sample data — banner on every screen, nothing sent; served from the
same Vercel project as the sync server it uses same-origin requests and
Google sign-in for the real queue, and the demo is not offered. All writes go through
a persistent offline outbox — nothing is lost in a dead spot. Every send
carries a client reference the server uses to recognise a re-send (a
report or photo that landed but whose answer never came back is not
created twice); a rejection the server would repeat is kept as
"rechazado" with the reason instead of retried forever, and the crew
can discard it from the outbox screen.

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
- **Offline-first** — everything saves locally (IndexedDB, so a visit
  full of photos fits; `apps/mobile/src/storage.ts`) and syncs when
  signal returns; the app says so in plain words ("Sin señal, no pasa
  nada"). A service worker generated at build time
  (`scripts/fix-web-html.mjs` → `public/sw.js`) caches the app shell, so
  a cold open with no signal still opens the app.
- **Photo gates** — cleanup proof photos and AFTER photos on repairs
  are required before items can close.
- **Photos from the phone's own gallery** (DB Crew T2.9, Carl 13 Oct
  2026) — a photo picked from the phone rather than taken in the app is
  posted with `source: "phone"` and `takenAt`, the time read from the photo
  itself. Its JobTread file is named by that time and its description says
  *picked from the phone's photos, taken Oct 12, 2026, 2:10 PM* (office
  time), or *time taken unknown* when the photo carried none — so a PM can
  tell a live shot from a picked one. A time that will not parse, or lies
  outside 2000 to a day ahead, is dropped, never refused (`photoOrigin` in
  `routes.ts`). Punch tasks carry `createdAt` in the job detail: DB Crew
  refuses an AFTER photo from the phone that was taken before the repair
  was asked for, or that carries no time, because it cannot show the fix.
  That rule is the app's — the client says where a photo came from, so the
  server records it and does not pretend to police it.
- **Reports can be dismissed** — the PM can mark a report
  no-action-needed with a reason (e.g. pre-existing damage); the photo
  and note stay on the JT job as documentation, and closeout unlocks
  once every report is assigned or dismissed.
- **JT is the system of record** — checklists live on the job's
  scheduled tasks, queue and assignments come from the Production board
  (job Status, moved by the board:
  Production → Final Inspection → Punch List → PM Review → Sales Rep > Cust
  Final Contact → Job Completed, the last by the rep), and all
  results land back on the JT job.

Customer names and addresses in the mockups are sample data; PM names
and job statuses come from the real Deitemeyer Brothers JobTread
configuration.
