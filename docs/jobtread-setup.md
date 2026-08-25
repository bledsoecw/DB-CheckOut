# JobTread setup — DB CheckOut

Created 2026-08-23 via the JobTread Pave API. These IDs are the contract
between JobTread and the DB CheckOut app/sync server. Do not rename or
delete these objects in JT without updating this file.

Organization: **Deitemeyer Brothers** — `22PBAjem8SSC`

## Forms (targetType: job)

The app renders these form templates as the crew checklists and writes
answers back as form submissions. English field names are the JT record;
the app displays the Spanish labels below (ES-first, EN below; the ES·EN
pill flips priority). Canonical option values are always stored as
`OK` / `N/A` / `ACTION` regardless of display language
(display: BIEN / N-A / FALLA in ES mode, OK / N-A / FIX in EN mode).

### DB Final Roofing Inspection — form `22PdEQfPn8wQ`

| Field id | JT field (EN, the record) | App label (ES) | Type |
| --- | --- | --- | --- |
| `22PdEQfPnVqh` | 1. Shingle field flat — no exposed fasteners or unaddressed damage | Tejas parejas, sin clavos expuestos | option |
| `22PdEQfPnVqi` | 2. Starter, eave/rake edges & drip edge complete and secure | Drip edge y bordes firmes | option |
| `22PdEQfPnVqj` | 3. Ridge & hip caps seated; valleys clean; transitions shed water | Caballete completo, valles limpios | option |
| `22PdEQfPnVqk` | 4. Pipe boots, static vents & ridge ventilation installed and sealed | Botas y ventilas bien selladas | option |
| `22PdEQfPnVqm` | 5. Step, headwall & sidewall flashing complete and integrated | Flashing en paredes completo | option |
| `22PdEQfPnVqn` | 6. Chimneys, skylights & penetrations flashed/reset as scoped | Chimenea y tragaluz con flashing | option |
| `22PdEQfPnVqp` | 7. Sealant appropriate — not a substitute for flashing; roof surface clear | Techo limpio, sin exceso de sellador | option |
| `22PdEQfPnVqq` | 8. Attic / interior spot check — leak-prone areas inspected | Revisión del ático — puntos de fuga | option |
| `22PdEQfPnVqr` | Attic access limitation / existing conditions | Limitación de acceso / condiciones existentes | longString |
| `22PdEQfPnVqs` | Inspector notes (English) | Notas | longString |

### DB Site Cleanup — form `22PdEQhB67dq`

| Field id | JT field (EN, the record) | App label (ES) | Type |
| --- | --- | --- | --- |
| `22PdEQhB6rSR` | 1. Driveway, walks & landscaping clean — magnet sweep completed | Barrido con imán — entrada, banquetas y jardín | option |
| `22PdEQhB6rSS` | 2. Unused materials, pallets, tarps & crew debris removed or staged | Materiales, lonas y basura recogidos | option |
| `22PdEQhB6rST` | 3. Gutters & downspouts clear of debris and reconnected | Canales y bajantes limpios y conectados | option |
| `22PdEQhB6rSU` | 4. No production damage — siding, windows, doors, AC, plants | Sin daños — siding, ventanas, AC, plantas | option |
| `22PdEQhB6rSV` | 5. General appearance — ready for the homeowner to view | Listo para que lo vea el cliente | option |
| `22PdEQhB6rSW` | Cleanup notes (English) | Notas | longString |

### DB Customer Walkthrough — form `22PdEpi4SNW3`

Sales-rep form at the Final Inspection milestone (does not wait for
punch items — the rep communicates the repair plan). **Gate: the job
does not move to `Pending Final Payment` until this form is
submitted.** English-only (sales reps).

| Field id | Field | Type |
| --- | --- | --- |
| `22PdEpi4SjQL` | 1. Walkthrough with homeowner (In person / By phone/video / Unavailable — documented) | option |
| `22PdEpi4SjQM` | 2. Sold scope complete — or approved changes/exclusions documented | option |
| `22PdEpi4SjQN` | 3. Remaining punch items & repair timing communicated | option |
| `22PdEpi4SjQP` | 4. Payment expectations reviewed — 40% now, 10% at job completion | option |
| `22PdEpi4SjQQ` | Customer concerns / commitments | longString |
| `22PdEpi4SjQR` | Follow-up — who owns the next action & when | longString |

Form roles:

- Inspection & Cleanup submitters: Crew `22PEWdLwFuDb`, Site Manager
  `22PEWeBJqFr4`, Roofing Production Manager `22PT7gAjFxyX`, Admin
  `22PBAjexsjjX`, **Sales Team `22PEWdJcCip7`** (reps inspect far jobs
  in the app, EN mode; punch fixes still route to the service crew)
- Inspection & Cleanup reviewers: Roofing Production Manager
  `22PT7gAjFxyX`, Construction Production Manager `22PEWd9dRa5k`,
  Admin `22PBAjexsjjX`
- Walkthrough submitters: Sales Team `22PEWdJcCip7`, Sales Team
  Manager `22PWktxywW8z`, Admin `22PBAjexsjjX`
- Walkthrough reviewers: Front Office `22PEWd4hUQ2j`, Accounts Manager
  `22PQcyVsGZTt`, Admin `22PBAjexsjjX`

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
  Created **unassigned**, progress 0; the Service Manager / PM edits it
  into a work order and assigns it on the Production board.
- `FIXED ON SITE: <location>` — crew corrected it during the visit.
  Created already **complete** (progress 1); it exists purely as
  documentation (what was found, materials & time, who did the original
  work when known). Nothing to assign.
- Completing a punch task with a crew note appends
  `✔ Done — <materials/time note>` to the task description.

Assignments to Alberto & Yahir come primarily through the **Service
Manager**, with coordination from the Roofing PM — the board surfaces we
label "PM" serve both roles.

## Status conventions (job custom field `22PBAjfWVVv9` "Status")

| Status value | Meaning for DB CheckOut |
| --- | --- |
| `Final Inspection` | Job enters the crew app queue — service/QC crew (or a sales rep on far jobs) inspects & cleans up |
| `Punch List` | Inspection reviewed; repairs assigned & in progress |
| `Punch Review` | All punch items done — **set automatically by the sync server when the last punch task closes with its after photo**; PM reviews photos & notes |
| `Job Completed` | PM approved the punch review (or clean pass with no punch items) |
| stays `Final Inspection` | Hold — correction required before advancing |

The pipeline is strictly linear (no status is ever re-entered), so
automations can safely key off status transitions. A rejected repair
moves the job back from `Punch Review` to `Punch List`.

## Payment milestones (CONFIRMED — agreed with Shawn, roofing jobs)

- 40% due when the inspection form submission is approved by its
  reviewer (the job leaves `Final Inspection`). One-time, dated,
  photo-backed event. The sales rep's walkthrough visit carries this
  milestone conversation.
- Final 10% due on status → `Job Completed` (fires once).
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
