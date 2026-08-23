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

Form roles (already configured on both forms):

- Submitters: Crew `22PEWdLwFuDb`, Site Manager `22PEWeBJqFr4`,
  Roofing Production Manager `22PT7gAjFxyX`, Admin `22PBAjexsjjX`
- Reviewers: Roofing Production Manager `22PT7gAjFxyX`,
  Construction Production Manager `22PEWd9dRa5k`, Admin `22PBAjexsjjX`

## Punch items → JT tasks

Punch/repair items are JT **tasks** on the job, using the existing task
type **Punch List** — `22PLePTbJVrQ` (already in the org; nothing was
created). Each task carries: PM-edited work-order description (English),
assignee (taskAssignment), due date, and photos attached to the job
tagged to the task. The existing **Inspection** task type
(`22PNJDrm6TsA`) can be used to schedule the inspection visit itself.

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

## Payment milestones (PROPOSED — pending confirmation with Shawn)

- 40% due when the inspection form submission is approved by its
  reviewer (the job leaves `Final Inspection`). One-time, dated,
  photo-backed event.
- Final 10% due on status → `Job Completed` (fires once).

Other job custom fields the app reads: Project Manager `22PC4DSTx7tg`,
Job Type `22PBzhnUydgC` (option "Roofing"), Sales Rep `22PBzhswJYd8`.

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
4. Pending decisions: add Sales Team (`22PEWdJcCip7`) as submitters on
   both forms (reps inspecting far jobs); create a "DB Customer
   Walkthrough" form for sales reps and pick which milestone it gates;
   confirm payment terms with Shawn.
