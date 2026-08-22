# DB CheckOut

Mobile field app for Deitemeyer Brothers roofing operations: final-inspection
quality control, post-job cleanup verification, and field-crew punch lists,
built around the DB Final Roofing Inspection checklist.

## design/

Design mockups for the app (one file per screen, laid out by `canvas.json`):

| File | Screen |
| --- | --- |
| `Jobs.dc.html` | Today's job list with offline sync status |
| `Main.dc.html` | Job overview — six checklist sections + DB Complete Gate |
| `Checklist.dc.html` | Section 1: Roof system & water-shedding (OK / N/A / ACTION) |
| `Cleanup.dc.html` | Section 2: Property & cleanup with photo proof and magnet sweep |
| `PunchList.dc.html` | Punch list with two-step closeout (Ready for review → Verified) |
| `PunchItem.dc.html` | Punch item detail — annotated photo, dictation, assignee, status |
| `Closeout.dc.html` | Complete Gate, final outcome (Pass / Pass with punch / Hold), sign-off |
| `AltHighVis.dc.html` | Alternate direction sketch: high-vis dark |
| `AltDense.dc.html` | Alternate direction sketch: paper-parity table |

Key design decisions:

- **Glove-friendly**: every control is a 44 px+ target; the three-state
  OK / N/A / ACTION toggles mirror the paper checklist columns.
- **Offline-first**: photos and checklists queue locally and sync when
  signal returns; sync state is always visible.
- **Photo-required rules**: cleanup items and punch corrections can require
  photo proof before they can be closed.
- **Two-step closeout**: crew marks items *Ready for review*; only a
  lead/PM can *Verify*. The Complete Gate blocks "Pass" while
  water-shedding, safety, or property-damage items are open.
- **JobTread/DB Cam aware**: dictated notes are AI-drafted for inspector
  review; closeout syncs the record to the JobTread job.

All customer names, addresses, and crew members in the mockups are sample
data.
