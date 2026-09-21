# JobTread setup — DB CheckOut

Created 2026-08-23 via the JobTread Pave API. These IDs are the contract
between JobTread and the DB CheckOut app/sync server. Do not rename or
delete these objects in JT without updating this file.

Organization: **Deitemeyer Brothers** — `22PBAjem8SSC`

## Crew checklists — on the scheduled "Final inspection" task (since 2026-09-21)

The crew checklists are the CHECKLIST (subtasks) on the job's scheduled
**"Final inspection"** task, copied from the pipeline task template below.
The two JT Forms the app used to submit — "DB Final Roofing Inspection"
`22PdEQfPn8wQ` and "DB Site Cleanup" `22PdEQhB67dq` — were removed from
JobTread and the app no longer submits any form. `POST /jobs/:id/inspection`
and `/cleanup` answer 410.

When the crew finishes the visit (`POST /jobs/:id/close-inspection`) the
sync server writes, in one `updateTask`:

- the task's `subtasks`, replaced in full: the eight inspection items, then
  the five cleanup items (`INSPECTION_ITEMS` / `CLEANUP_ITEMS` in
  `packages/shared/src/jobtread.ts` — the subtask names below, word for
  word, because a subtask has no id and is matched by name);
- the task's `description`, with `✔ Inspected by <name> — via DB CheckOut`
  and the inspector, attic-limitation and cleanup notes appended (once —
  a duplicate outbox delivery finds its own stamp and leaves it);
- `progress: 1`.

Answers collapse to the subtask's two states. `OK` and `N/A` tick. An
`ACTION` the crew **fixed on site** ticks too (nothing is left to do). An
`ACTION` that became a `REPORT:` punch task stays unticked and is ticked
by the sync server when that punch task closes (the to-do carries
`DB CheckOut item: 8` to say which line it came from). The entries keep
the template's names, untouched.

**Notes and photos are task MESSAGES, not description.** Each finding is
posted as a message on the "Final inspection" task that starts with the
checklist line it is about (`8. Attic / interior spot check …`), then
`⚠ REPORT (punch item) — <note>` or `✔ FIXED ON SITE — <note>`, where it
is, materials/time, what the crew said verbatim, who reported it. The
report's photos are uploaded once, to the punch to-do, and then linked to
that message (a message's file list is rewritten with the file — JT
replaces the list on update). The crew's free-text inspection/attic/
cleanup notes are one more message on the task. Messages are internal
only (not visible to customer or vendor roles). Visit photos attach to
the "Final inspection" task instead of the bare job. The task description
only ever gets the `✔ Inspected by <name> — via DB CheckOut` stamp.

**JobTread derives a checklist task's progress from its ticks** (ticked /
total, whatever `progress` is written), so a reported line keeps "Final
inspection" under 100% until the punch work is done. The pipeline
therefore reads the `✔ Inspected by …` stamp in the description, not the
progress, to know the crew closed the inspection. English is the record;
the app displays the Spanish labels (ES-first, the ES·EN pill flips
priority; BIEN / N-A / FALLA in ES mode, OK / N-A / FIX in EN mode).

The item keys the app uses (`22PdEQ…`) are the ids of the retired form
fields, kept as opaque keys so nothing saved on a phone was lost.

| App key | Subtask on "Final inspection" | App label (ES) |
| --- | --- | --- |
| `22PdEQfPnVqh` | 1. Shingle field flat — no exposed fasteners or unaddressed damage | Tejas parejas, sin clavos expuestos |
| `22PdEQfPnVqi` | 2. Starter, eave/rake edges & drip edge complete and secure | Drip edge y bordes firmes |
| `22PdEQfPnVqj` | 3. Ridge & hip caps seated; valleys clean; transitions shed water | Caballete completo, valles limpios |
| `22PdEQfPnVqk` | 4. Pipe boots, static vents & ridge ventilation installed and sealed | Botas y ventilas bien selladas |
| `22PdEQfPnVqm` | 5. Step, headwall & sidewall flashing complete and integrated | Flashing en paredes completo |
| `22PdEQfPnVqn` | 6. Chimneys, skylights & penetrations flashed/reset as scoped | Chimenea y tragaluz con flashing |
| `22PdEQfPnVqp` | 7. Sealant appropriate — not a substitute for flashing; roof surface clear | Techo limpio, sin exceso de sellador |
| `22PdEQfPnVqq` | 8. Attic / interior spot check — leak-prone areas inspected | Revisión del ático — puntos de fuga |
| `22PdEQhB6rSR` | Cleanup 1. Driveway, walks & landscaping clean — magnet sweep completed | Barrido con imán — entrada, banquetas y jardín |
| `22PdEQhB6rSS` | Cleanup 2. Unused materials, pallets, tarps & crew debris removed or staged | Materiales, lonas y basura recogidos |
| `22PdEQhB6rST` | Cleanup 3. Gutters & downspouts clear of debris and reconnected | Canales y bajantes limpios y conectados |
| `22PdEQhB6rSU` | Cleanup 4. No production damage — siding, windows, doors, AC, plants | Sin daños — siding, ventanas, AC, plantas |
| `22PdEQhB6rSV` | Cleanup 5. General appearance — ready for the homeowner to view | Listo para que lo vea el cliente |

Free text (into the task description): `22PdEQfPnVqr` attic access
limitation / existing conditions, `22PdEQfPnVqs` inspector notes,
`22PdEQhB6rSW` cleanup notes.

**The template carries all thirteen subtasks** (the five `Cleanup n.`
lines were added to its "Final inspection" task on 2026-09-21), so every
job copied from it shows the whole checklist before the visit. Jobs copied
earlier have eight; the app writes all thirteen either way, because the
list replaces on update.

### DB Customer Walkthrough — form `22PdEpi4SNW3` (still a JT Form)

Sales-rep form at the Final Inspection milestone (does not wait for
punch items — the rep communicates the repair plan). **Gate: the job
does not move to `Pending Final Payment` until this form is
submitted.** English-only (sales reps). Not used by the crew app.

| Field id | Field | Type |
| --- | --- | --- |
| `22PdEpi4SjQL` | 1. Walkthrough with homeowner (In person / By phone/video / Unavailable — documented) | option |
| `22PdEpi4SjQM` | 2. Sold scope complete — or approved changes/exclusions documented | option |
| `22PdEpi4SjQN` | 3. Remaining punch items & repair timing communicated | option |
| `22PdEpi4SjQP` | 4. Payment expectations reviewed — 40% now, 10% at job completion | option |
| `22PdEpi4SjQQ` | Customer concerns / commitments | longString |
| `22PdEpi4SjQR` | Follow-up — who owns the next action & when | longString |

Walkthrough roles: submitters Sales Team `22PEWdJcCip7`, Sales Team
Manager `22PWktxywW8z`, Admin `22PBAjexsjjX`; reviewers Front Office
`22PEWd4hUQ2j`, Accounts Manager `22PQcyVsGZTt`, Admin `22PBAjexsjjX`.

## Punch items → JT tasks

Punch/repair items are JT **tasks** on the job, using the existing task
type **Punch List** — `22PLePTbJVrQ` (already in the org; nothing was
created). Each task carries: PM-edited work-order description (English),
assignee (taskAssignment), due date, and photos attached to the job
tagged to the task. The existing **Inspection** task type
(`22PNJDrm6TsA`) can be used to schedule the inspection visit itself.

Task naming conventions (per Shawn's Service & QC Team Responsibilities
doc — "correct it rather than simply report it"):

- `REPORT: <location>` — crew found a problem that needs a return trip.
  Progress 0. On a **roofing job** (Job Type `Roofing`, or any `R-`
  Project Type) it is created **assigned to the punch crew** — Alberto
  Gonzalez `22PdPUpWzpHy` and Yahir Gonzalez `22PdPTwMdkzj`, the staff
  memberships (`PUNCH_CREW` in `packages/shared/src/jobtread.ts`); on a
  construction job it is created unassigned for the PM. The Service
  Manager / PM edits it into a work order on the Production board.
- `FIXED ON SITE: <location>` — crew corrected it during the visit.
  Created already **complete** (progress 1); it exists purely as
  documentation (what was found, materials & time, who did the original
  work when known). Nothing to assign.
- Completing a punch task with a crew note appends
  `✔ Done — <materials/time note>` to the task description.

Assignments to Alberto & Yahir come primarily through the **Service
Manager** — that role is **Dave Elick**, the Service/Repair & Warranty
project manager — with coordination from the Roofing PM. The board
surfaces we label "PM" serve both roles; on service jobs the job's PM
field is normally Dave.

## The pipeline task template — `22PeHi4zyTkx`

**"Roofing Schedule - Phase I"** is copied onto every roofing job
(`copyTaskTemplateToTarget`). Its six tasks ARE the pipeline, and
completing two of them is what moves the job's Status.

| # | Task | Task type | Role |
| --- | --- | --- | --- |
| 1 | Order materials | Pre-Production `22PDM6m8Vdqw` | planning bar |
| 2 | Roof install | Pre-Production `22PDM6m8Vdqw` | planning bar |
| 3 | Final inspection | **Inspection `22PNJDrm6TsA`** | carries the 8 checklist items as **subtasks**; the crew app ticks them and completes it |
| 4 | Punch list | **Punch List `22PLePTbJVrQ`** (since 2026-09-21; scheduled, not a to-do) | phase marker; **its checklist mirrors the job's punch to-dos** (`REPORT: <where>`, ticked when the to-do closes), it completes with the last one, and a clean inspection marks it "not required" in the notes |
| 5 | PM punch review | General `22PBAjfWNQrT` | PM's own check-off (no status of its own) |
| 6 | Final check-off | General `22PBAjfWNQrT` | **sales rep** has spoken to the customer; completing it closes the job |

**Every task carries a type on purpose, and two of those choices are
load-bearing:**

- **"Punch list" is typed Punch List but is a SCHEDULED task, never a
  to-do.** Punch items are the Punch List-typed **to-dos** the app creates;
  `listPunchTasks` and the assigned-work scan filter on type AND `isToDo`,
  so the phase task never counts as an unfinished punch item.
- **"Order materials" and "Roof install" are Pre-Production, not Install
  or Roofing.** The DB Production Board's task sweep accepts Install,
  Roofing **and untyped** tasks and then resolves a crew from the
  assignees — so an untyped "Roof install" with a crew on it renders on
  the board as a phantom crew visit. Pre-Production is invisible to it.

**JobTread does not set `taskTemplate` on the copies** (verified live on
job 25-0001): a copied task has no back-reference to the template. The
task NAME is the durable marker — `findPipelineTask` matches on name,
with the type only breaking a tie between two same-named tasks — so
renaming one of these tasks in JT breaks its link to the automation.
The type alone can never match: the org types every sales rep's
inspection visit as Inspection too, so a job without the template has
exactly one Inspection-typed task that is NOT the milestone, and older
template copies carry no task types at all.

**Subtasks are `{ name, isComplete }` — two states, not three.** The
app's `OK` / `N/A` / `ACTION` collapses to ticked / unticked: OK and N/A
tick, ACTION does not. Nothing is lost, because an ACTION is what created
the `REPORT:` punch task, which is where that finding actually lives.
`subtasks` REPLACES on update (like `dependsOnTasks`), so the full list
goes every write — which is what makes closing the inspection idempotent.

**Template descriptions vs. the pipeline (open point, 2026-09-21).** The
descriptions on the template's tasks were rewritten on 2026-09-17 and
read punch work → PM Review → Final inspection → Job Completed ("PM
Review … Completing this task moves the job to Final Inspection", "Final
inspection … When it passes, move the job Status to Job Completed"). The
template's task ORDER, the status table below, and live practice (both
completed "Final inspection" tasks sit at `Punch List`) still say Final
Inspection → Punch List → PM Review → Final check-off, which is what the
sync server implements. If the prose is the intent, the routing in
`apps/sync/src/pipeline.ts` has to change with it — decide one way and
make the template say the same.

`updateTask` defaults **`updateDependentTasks: true`**: JobTread cascades
a date change onto everything downstream by its own rules. These six are
a dependency chain, so every task write the sync server makes passes
`false` (`TASK_WRITE_GUARDS` in `apps/sync/src/jt.ts`).

## Status conventions (job custom field `22PBAjfWVVv9` "Status")

| Status value | Meaning for DB CheckOut |
| --- | --- |
| `Final Inspection` | Job enters the crew app queue — service/QC crew (or a sales rep on far jobs) inspects & cleans up |
| `Punch List` | **Set automatically when the crew completes "Final inspection" and the visit found open problems**; repairs assigned & in progress |
| `PM Review` (was `Punch Review` until 2026-09-16) | Set automatically either when the last punch task closes with its after photo, **or when a clean inspection completes with nothing to repair**; the PM reviews photos & notes and ticks "PM punch review" |
| `Job Completed` | **Set automatically when the sales rep ticks "Final check-off"** — they have spoken to the customer and all is well |
| stays `Final Inspection` | Hold — correction required before advancing, or the job never got the template |

```
Final Inspection ──(crew completes "Final inspection")──┬─ problems? ──> Punch List
                                                        └─ clean?    ──> PM Review
Punch List ──────(last punch task closes)──────────────────────────────> PM Review
PM Review ───────(PM ticks "PM punch review", then the sales rep speaks
                  to the customer and ticks "Final check-off")─────────> Job Completed
```

The PM's own tick is a human gate with **no status of its own** — the job
waits at `PM Review` through both check-offs, and only the sales rep's
closes it. That is deliberate: `Job Completed` fires the final 10% payment
milestone, so a person talks to the customer before any of this touches
money.

The pipeline is strictly linear (no status is ever re-entered), so
automations can safely key off status transitions — and that is also what
makes every rule idempotent: each is guarded on the status it moves OUT
of, so a duplicate delivery from the app's offline outbox is a no-op. A
rejected repair moves the job back from `PM Review` to `Punch List`.

**The routing does not depend on write ordering.** The app's outbox
(`flushOutbox`) continues past a failing item rather than stopping, so a
`REPORT:` task can reach JobTread *after* the close that is meant to
notice it. `POST /jobs/:id/close-inspection` therefore carries the visit's
own `problemsReported` count, and the decision takes the larger of that
and the open punch tasks actually on the job.

There is no form any more: the task's checklist plus its description
(who inspected, the notes) and the photos on the job are the record.

## Payment milestones (CONFIRMED — agreed with Shawn, roofing jobs)

- 40% due at the inspection milestone — the template now links the 40%
  scheduled invoice to the "Roof install" task, and the crew's completed
  "Final inspection" task (dated, photo-backed) is the inspection record.
  The sales rep's walkthrough visit carries this milestone conversation.
- Final 10% due on status → `Job Completed` (fires once); the template
  links the final scheduled invoice to "Final check-off".
- `Pending Final Payment` additionally requires a submitted
  DB Customer Walkthrough form.

## Job classification (Job Type & Project Type)

Convention agreed 2026-08-25:

- **Job Type `22PBzhnUydgC` is the division only**: `Roofing` or
  `Construction`. The old third option `Service/Repair` is retired —
  it double-encoded what Project Type already says.
- **Project Type `22PC7idvhRzp` is the kind of work** (multi-value).
  `R-` values are roofing work, `C-` construction. The service markers
  are **`R-Repairs/Service` and `R-Warranty`** — any job carrying one
  of them is a service call (the app shows a Servicio badge via
  `SERVICE_PROJECT_TYPES` in `packages/shared/src/jobtread.ts`).
  Service jobs flow through the normal pipeline statuses.

Data migration executed 2026-08-25 via the Pave API: 346 jobs moved off
`Service/Repair` (302 → Roofing, 44 → Construction) and 47 jobs with no
Job Type were filled from their Project Type prefix (43 Roofing,
4 Construction). Only when every Project Type on the job shared one
prefix was it auto-changed; 137 ambiguous jobs (mixed R-/C-, no Project
Type, or Job Type contradicting the prefix) were left untouched on a
review list. The `Service/Repair` option itself still needs to be
removed from the field's options in JT settings once the review jobs
are resolved.

Other job custom fields the app reads: Project Manager `22PC4DSTx7tg`,
Sales Rep `22PBzhswJYd8`.

## Sold scope (job documents)

The job screen shows the sold scope so the crew has the original work
order and approved changes in hand before inspecting (per Shawn's
Service & QC doc). Scope = every job **document** with
`type = customerOrder` and `status = approved`, oldest first — the
signed estimate plus approved change orders. Invoices, vendor
orders/bills, and drafts are not scope. Line items come from the
document's `costItems` (name, quantity, unit, description). Verified
live 2026-08-25 on job 26-0261.

## Pave API notes (learned while creating)

- `createForm` field options shape: `{"options": ["OK", "N/A", "ACTION"]}`.
- `reviewerRoleIds` and `submitterRoleIds` are required on `createForm`.
- Mutation results are selected via the nested `created*` key
  (e.g. `createForm.createdForm.id`).
- Available for the sync server (verified in schema): `createWebhook`
  (job-status change notifications), `createTask` + task assignments,
  `createFile` + `fileTag` (photos on the job), `createFormSubmission`.

## Not yet done (next steps)

1. Scaffold `apps/mobile` (Expo/React Native) and `apps/sync`
   (Node/TypeScript Pave client + webhook receiver + voice pipeline).
2. Register a webhook via `createWebhook` once the sync server has a URL.
3. Obtain a JobTread API grant key for the sync server (org settings).
