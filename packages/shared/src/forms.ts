/**
 * Close Out's forms, as data (T2.25, 29 Oct 2026).
 *
 * The crew's phone (DB Crew, `bledsoecw/db-crew-app`) used to carry the roof
 * checklist in its own code, word for word beside FIELD_LABELS here — and the
 * two had already drifted (the phone said "lawn" for the magnet sweep, this
 * file "yard"). The job detail now carries the form (`forms`, and `jobForm`
 * naming the one this job uses), and the phone draws whatever it is handed,
 * keeping its own copy only for a server too old to send one. So rewording an
 * item, or adding a whole form — the construction walk-through Neal will
 * write — is a server change and a deploy, never an app release.
 *
 * A form is sections, each a list of items the crew answers OK · N/A · Fix,
 * with one note per section. `key` is the item's stable id (what an answer
 * is stored under), `n` the short code written into a REPORT task. The roof
 * form is built from INSPECTION_ITEMS / CLEANUP_ITEMS, so the subtasks
 * close-inspection writes and the items the phone shows can never disagree.
 *
 * A NEW form needs its write path too: close-inspection refuses a form it
 * does not know how to write rather than writing it as the roof's.
 */
import { CLEANUP_ITEMS, INSPECTION_ITEMS } from "./jobtread";
import { FIELD_LABELS, UI } from "./i18n";
import type { CloseoutForm } from "./types";

function items(list: ReadonlyArray<{ key: string; code: string }>) {
  return list.map((i) => ({ key: i.key, n: i.code, es: FIELD_LABELS[i.key]?.es ?? "", en: FIELD_LABELS[i.key]?.en ?? "" }));
}

export const ROOF_FORM: CloseoutForm = {
  key: "roof",
  sections: [
    { key: "inspection", label: { es: UI.inspection.es, en: UI.inspection.en }, items: items(INSPECTION_ITEMS) },
    { key: "cleanup", label: { es: UI.cleanup.es, en: UI.cleanup.en }, items: items(CLEANUP_ITEMS) },
  ],
};

/** Every form close-inspection knows how to write. */
export const CLOSEOUT_FORMS: Readonly<Record<string, CloseoutForm>> = { roof: ROOF_FORM };

/** The form a job's crew inspection uses. Only the roof's is written yet. */
export function jobFormKey(): string {
  return "roof";
}
