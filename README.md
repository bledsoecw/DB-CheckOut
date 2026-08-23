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
   "Terminado" button. The PM verifies and moves the JT status to
   **Punch List** → **Job Completed**.

## design/

Design mockups (one file per screen, laid out by `canvas.json`):

| File | Screen |
| --- | --- |
| `Flow.dc.html` | Integration map — Production board → crew app → back to JT |
| `Jobs.dc.html` | Mis trabajos — auto-filled job queue with directions |
| `Main.dc.html` | Job home — Inspección / Limpieza / Reportar problema tiles |
| `Checklist.dc.html` | Inspection checklist — big BIEN / N/A / FALLA buttons |
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
  with English small underneath; an ES/EN toggle flips the priority.
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
  Production → Final Inspection → Punch List → Job Completed), and all
  results land back on the JT job.

Customer names and addresses in the mockups are sample data; PM names
and job statuses come from the real Deitemeyer Brothers JobTread
configuration.
